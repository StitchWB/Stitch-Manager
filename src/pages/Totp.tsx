import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  KeyRound,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ShieldCheck,
  Link2,
  ChevronDown,
  ChevronRight,
  FolderTree,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import {
  Button,
  IconButton,
  Input,
  EmptyState,
  Tooltip,
  ToolbarSearchField,
} from '@/components/ui';
import { useTotpStore } from '../stores/totp';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { TotpKey } from '@/lib/tauri/modules/totp';
import { TotpBadge } from '../components/totp/TotpBadge';
import { isOtpauthUri, parseOtpauthUri } from '@/lib/otpauth';
import { cn } from '../lib/utils';

/* ── Add / Edit form state ── */
interface FormState {
  label: string;
  secret: string;
  issuer: string;
  digits?: number;
  period?: number;
  algorithm?: string;
}

const EMPTY_FORM: FormState = { label: '', secret: '', issuer: '' };

const SEARCH_INPUT_ID = 'totp-search';

/* Common issuer presets; merged with issuers already in use */
const ISSUER_PRESETS = ['Kiro', 'AWS Builder ID', 'GitHub', 'Google', 'Microsoft', 'Discord'];

/* ── Normalize secret: strip spaces/dashes, uppercase ── */
function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/* ── Validate Base32 ── */
function isValidBase32(s: string): boolean {
  return /^[A-Z2-7]+=*$/.test(s) && s.length >= 8;
}

/** Group keys by issuer (null = no issuer), groups sorted A–Z, no-issuer last */
function groupByIssuer(keys: TotpKey[]): { issuer: string | null; keys: TotpKey[] }[] {
  const map = new Map<string | null, TotpKey[]>();
  for (const k of keys) {
    const issuer = k.issuer || null;
    const bucket = map.get(issuer);
    if (bucket) bucket.push(k);
    else map.set(issuer, [k]);
  }
  return [...map.entries()]
    .map(([issuer, groupKeys]) => ({ issuer, keys: groupKeys }))
    .sort((a, b) => {
      if (a.issuer === null) return 1;
      if (b.issuer === null) return -1;
      return a.issuer.localeCompare(b.issuer);
    });
}

export default function Totp() {
  const { keys, loading, fetchKeys, addKey, updateKey, removeKey } = useTotpStore();
  // Re-render on language change so t() re-evaluates
  const { language } = useAppStore();
  void language;

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIssuer, setEditIssuer] = useState('');

  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'alpha'>('newest');
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  /* ── "/" focuses search from anywhere ── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      e.preventDefault();
      document.getElementById(SEARCH_INPUT_ID)?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ── Secret field: auto-detect pasted otpauth:// URI ── */
  const handleSecretChange = useCallback((value: string) => {
    setFormError('');
    if (isOtpauthUri(value)) {
      const parsed = parseOtpauthUri(value);
      if (parsed) {
        setForm({
          label: parsed.label,
          issuer: parsed.issuer ?? '',
          secret: parsed.secret,
          digits: parsed.digits,
          period: parsed.period,
          algorithm: parsed.algorithm,
        });
        toast.success(t('totp.uriDetected'));
      } else {
        setForm((f) => ({ ...f, secret: value }));
        setFormError(t('totp.invalidOtpauth'));
      }
      return;
    }
    setForm((f) => ({ ...f, secret: value }));
  }, []);

  /* ── Add ── */
  const handleAdd = useCallback(async () => {
    const secret = normalizeSecret(form.secret);
    if (!form.label.trim()) {
      setFormError(t('totp.labelRequired'));
      return;
    }
    if (!isValidBase32(secret)) {
      setFormError(t('totp.invalidSecret'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await addKey({
        label: form.label.trim(),
        secret,
        issuer: form.issuer.trim() || null,
        ...(form.digits ? { digits: form.digits } : {}),
        ...(form.period ? { period: form.period } : {}),
        ...(form.algorithm ? { algorithm: form.algorithm } : {}),
      });
      toast.success(t('totp.keyAdded'));
      setForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('totp.addFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, addKey]);

  /* ── Edit save ── */
  const handleEditSave = useCallback(
    async (id: string) => {
      if (!editLabel.trim()) return;
      try {
        await updateKey({ id, label: editLabel.trim(), issuer: editIssuer.trim() || null });
        toast.success(t('totp.keyUpdated'));
        setEditId(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('totp.updateFailed'));
      }
    },
    [editLabel, editIssuer, updateKey]
  );

  /* ── Two-click delete: first click arms (red glow), second deletes ── */
  const handleDeleteClick = useCallback(
    async (key: TotpKey) => {
      if (armedDeleteId !== key.id) {
        setArmedDeleteId(key.id);
        return;
      }
      setArmedDeleteId(null);
      try {
        await removeKey(key.id);
        toast.success(t('totp.keyRemoved'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('totp.removeFailed'));
      }
    },
    [armedDeleteId, removeKey]
  );

  /* Auto-disarm after 3s */
  useEffect(() => {
    if (!armedDeleteId) return;
    const timer = window.setTimeout(() => setArmedDeleteId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [armedDeleteId]);

  /* ── Filtered + sorted keys ── */
  const filteredSortedKeys = useMemo(() => {
    let result = keys;
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (k) => k.label.toLowerCase().includes(q) || (k.issuer?.toLowerCase().includes(q) ?? false)
      );
    }
    if (sort === 'alpha') {
      result = [...result].sort((a, b) => a.label.localeCompare(b.label));
    } else {
      // Backend returns created_at ASC — reverse for newest first.
      // ISO strings compare lexicographically; nulls sort last.
      result = [...result].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    }
    return result;
  }, [keys, query, sort]);

  /* ── Issuer autocomplete: user's own issuers first, then presets ── */
  const issuerSuggestions = useMemo(() => {
    const existing = keys.map((k) => k.issuer).filter((i): i is string => !!i);
    return [...new Set([...existing, ...ISSUER_PRESETS])].sort((a, b) => a.localeCompare(b));
  }, [keys]);

  /* ── Groups (only when grouping is on) ── */
  const groups = useMemo(
    () => (grouped ? groupByIssuer(filteredSortedKeys) : []),
    [filteredSortedKeys, grouped]
  );

  const toggleGroup = useCallback((issuer: string | null) => {
    const groupKey = issuer ?? '';
    setCollapsed((c) => ({ ...c, [groupKey]: !c[groupKey] }));
  }, []);

  const startEdit = (key: TotpKey) => {
    setEditId(key.id);
    setEditLabel(key.label);
    setEditIssuer(key.issuer ?? '');
  };

  const renderRow = (key: TotpKey, showIssuer: boolean) => (
    <TotpKeyRow
      key={key.id}
      totpKey={key}
      showIssuer={showIssuer}
      issuerSuggestions={issuerSuggestions}
      isEditing={editId === key.id}
      editLabel={editLabel}
      editIssuer={editIssuer}
      onEditLabelChange={setEditLabel}
      onEditIssuerChange={setEditIssuer}
      onStartEdit={() => startEdit(key)}
      onSaveEdit={() => void handleEditSave(key.id)}
      onCancelEdit={() => setEditId(null)}
      isDeleteArmed={armedDeleteId === key.id}
      onDelete={() => void handleDeleteClick(key)}
    />
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="2FA / Authenticator" icon={<ShieldCheck size={18} />} />

      {/* Page header + add button */}
      <div className="shrink-0 px-6 pt-6 pb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">
            {t('totp.title')} · {keys.length}
          </h3>
          <p className="text-slate-500 text-xs">{t('totp.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setShowAddForm((v) => !v);
            setForm(EMPTY_FORM);
            setFormError('');
          }}
          className="shrink-0"
        >
          <Plus size={14} className="mr-1" />
          {t('totp.addKey')}
        </Button>
      </div>

      {/* Toolbar */}
      <div className="shrink-0 px-6 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <ToolbarSearchField
            id={SEARCH_INPUT_ID}
            value={query}
            onValueChange={setQuery}
            placeholder={t('totp.searchPlaceholder')}
            shellClassName="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'alpha')}
            className="bg-white/5 border border-white/10 rounded-md text-xs px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-500/40 cursor-pointer shrink-0"
          >
            <option value="newest">{t('totp.sortNewest')}</option>
            <option value="alpha">{t('totp.sortAlpha')}</option>
          </select>
          <IconButton
            variant="ghost"
            size="sm"
            tooltip={t('totp.groupByIssuer')}
            onClick={() => setGrouped((v) => !v)}
            className={cn(
              'shrink-0',
              grouped && 'text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20'
            )}
          >
            <FolderTree size={14} />
          </IconButton>
        </div>
      </div>

      {/* Scrollable area */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {/* Add form */}
        {showAddForm && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
            <p className="text-sm font-semibold text-white">{t('totp.formTitle')}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">{t('totp.labelLabel')}</label>
                <Input
                  placeholder={t('totp.labelPlaceholder')}
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">{t('totp.issuerLabel')}</label>
                <IssuerSuggestInput
                  placeholder={t('totp.issuerPlaceholder')}
                  value={form.issuer}
                  onChange={(v) => setForm((f) => ({ ...f, issuer: v }))}
                  suggestions={issuerSuggestions}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">{t('totp.secretLabel')}</label>
              <Input
                placeholder={t('totp.secretPlaceholder')}
                value={form.secret}
                onChange={(e) => handleSecretChange(e.target.value)}
                className="font-mono"
              />
              {formError && <p className="text-xs text-red-400">{formError}</p>}
            </div>

            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setForm(EMPTY_FORM);
                  setFormError('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleAdd} disabled={saving}>
                {saving ? t('totp.adding') : t('totp.addKey')}
              </Button>
            </div>
          </div>
        )}

        {/* Keys list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            {t('common.loading')}
          </div>
        ) : keys.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={KeyRound}
              title={t('totp.emptyTitle')}
              description={t('totp.emptyDescription')}
            />
          </div>
        ) : filteredSortedKeys.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            {t('totp.noMatch')}
          </div>
        ) : grouped ? (
          groups.map((g) => {
            const groupKey = g.issuer ?? '';
            const isCollapsed = !!collapsed[groupKey];
            return (
              <div key={groupKey || '__no_issuer__'}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.issuer)}
                  className="flex w-full items-center gap-1.5 px-1 pt-3 pb-1 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="truncate">{g.issuer ?? t('totp.noIssuer')}</span>
                  <span className="font-normal text-slate-600">{g.keys.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-white/[0.04]">
                    {g.keys.map((key) => renderRow(key, false))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filteredSortedKeys.map((key) => renderRow(key, true))}
          </div>
        )}
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════════════
   TOTP Key Row
   ═══════════════════════════════════════════════ */

interface TotpKeyRowProps {
  totpKey: TotpKey;
  showIssuer: boolean;
  issuerSuggestions: string[];
  isEditing: boolean;
  editLabel: string;
  editIssuer: string;
  onEditLabelChange: (v: string) => void;
  onEditIssuerChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isDeleteArmed: boolean;
  onDelete: () => void;
}

function TotpKeyRow({
  totpKey,
  showIssuer,
  issuerSuggestions,
  isEditing,
  editLabel,
  editIssuer,
  onEditLabelChange,
  onEditIssuerChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  isDeleteArmed,
  onDelete,
}: TotpKeyRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 py-1.5 transition-colors',
        isEditing ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]'
      )}
    >
      {/* Icon chip */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
        <KeyRound size={14} className="text-indigo-400" />
      </div>

      {/* Label + issuer + accountId */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editLabel}
              onChange={(e) => onEditLabelChange(e.target.value)}
              placeholder={t('totp.labelLabel')}
              className="h-7 text-sm"
            />
            <IssuerSuggestInput
              value={editIssuer}
              onChange={onEditIssuerChange}
              placeholder={t('totp.issuerLabel')}
              className="h-7 text-sm"
              suggestions={issuerSuggestions}
            />
            <IconButton
              onClick={onSaveEdit}
              variant="ghost"
              size="sm"
              tooltip={t('common.save')}
              className="text-emerald-400 hover:text-emerald-300"
            >
              <Check size={14} />
            </IconButton>
            <IconButton
              onClick={onCancelEdit}
              variant="ghost"
              size="sm"
              tooltip={t('common.cancel')}
            >
              <X size={14} />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-white truncate">{totpKey.label}</span>
            {showIssuer && totpKey.issuer && (
              <span className="text-xs text-slate-500 truncate">{totpKey.issuer}</span>
            )}
            {totpKey.accountId && (
              <Tooltip content={t('totp.linkedAccount')} side="top">
                <Link2 size={12} className="text-indigo-400 shrink-0" />
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* TotpBadge — row variant */}
      {!isEditing && <TotpBadge secret={totpKey.secret} period={totpKey.period} variant="row" />}

      {/* Actions */}
      {!isEditing && (
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            onClick={onStartEdit}
            variant="ghost"
            size="sm"
            tooltip={t('totp.editTooltip')}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <Pencil size={14} />
          </IconButton>
          <IconButton
            onClick={onDelete}
            variant="ghost"
            size="sm"
            tooltip={isDeleteArmed ? t('totp.deleteConfirm') : t('totp.removeTooltip')}
            className={cn(
              'transition-all',
              isDeleteArmed
                ? 'opacity-100 text-red-400 bg-red-500/20 border border-red-500/50 drop-shadow-[0_0_4px_rgba(239,68,68,0.8)] animate-[glow-red_1.5s_ease-in-out_infinite]'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-slate-500 hover:text-red-400'
            )}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Issuer suggest input — kit-styled autocomplete
   (popup classes mirror ui/Select dropdown)
   ═══════════════════════════════════════════════ */

interface IssuerSuggestInputProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
}

function IssuerSuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: IssuerSuggestInputProps) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions.filter((s) => s.toLowerCase() !== q && (!q || s.toLowerCase().includes(q)));
  }, [suggestions, value]);

  return (
    <div className="relative flex-1 min-w-0">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg bg-slate-900 border border-white/10 shadow-xl shadow-black/40">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-white/5 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
