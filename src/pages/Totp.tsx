import { useEffect, useState, useCallback } from 'react';
import {
  KeyRound,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ShieldCheck,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import {
  Button,
  IconButton,
  Input,
  EmptyState,
  ConfirmDialog,
  Tooltip,
} from '@/components/ui';
import { useTotpStore } from '../stores/totp';
import type { TotpKey } from '@/lib/tauri/modules/totp';
import { TotpBadge } from '../components/totp/TotpBadge';
import { cn } from '../lib/utils';

/* ── Add / Edit form state ── */
interface FormState {
  label: string;
  secret: string;
  issuer: string;
}

const EMPTY_FORM: FormState = { label: '', secret: '', issuer: '' };

/* ── Normalize secret: strip spaces/dashes, uppercase ── */
function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/* ── Validate Base32 ── */
function isValidBase32(s: string): boolean {
  return /^[A-Z2-7]+=*$/.test(s) && s.length >= 8;
}

export default function Totp() {
  const { keys, loading, fetchKeys, addKey, updateKey, removeKey } = useTotpStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIssuer, setEditIssuer] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<TotpKey | null>(null);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  /* ── Add ── */
  const handleAdd = useCallback(async () => {
    const secret = normalizeSecret(form.secret);
    if (!form.label.trim()) {
      setFormError('Label is required');
      return;
    }
    if (!isValidBase32(secret)) {
      setFormError('Invalid secret — must be a Base32 string (A–Z, 2–7)');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await addKey({
        label: form.label.trim(),
        secret,
        issuer: form.issuer.trim() || null,
      });
      toast.success('2FA key added');
      setForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add key');
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
        toast.success('Key updated');
        setEditId(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update key');
      }
    },
    [editLabel, editIssuer, updateKey]
  );

  /* ── Delete confirm ── */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await removeKey(deleteTarget.id);
      toast.success('Key removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove key');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, removeKey]);

  const startEdit = (key: TotpKey) => {
    setEditId(key.id);
    setEditLabel(key.label);
    setEditIssuer(key.issuer ?? '');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="2FA / Authenticator" icon={<ShieldCheck size={18} />} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page header + add button */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">TOTP Keys</h3>
            <p className="text-slate-500 text-xs">
              Manage Time-based One-Time Password secrets. Codes are generated locally — your secrets never leave this device.
            </p>
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
            Add key
          </Button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
            <p className="text-sm font-semibold text-white">New TOTP key</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Label *</label>
                <Input
                  placeholder="e.g. My Kiro account"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Issuer (optional)</label>
                <Input
                  placeholder="e.g. Kiro, GitHub"
                  value={form.issuer}
                  onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Secret key *</label>
              <Input
                placeholder="e.g. QOC2VNJ7MFNRH7545F3FBR4E7YP7RVSQ"
                value={form.secret}
                onChange={(e) => {
                  setForm((f) => ({ ...f, secret: e.target.value }));
                  setFormError('');
                }}
                className="font-mono"
              />
              {formError && (
                <p className="text-xs text-red-400">{formError}</p>
              )}
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
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleAdd} disabled={saving}>
                {saving ? 'Adding…' : 'Add key'}
              </Button>
            </div>
          </div>
        )}

        {/* Keys list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            Loading…
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No 2FA keys yet"
            description="Add a TOTP secret key to start generating codes"
          />
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <TotpKeyCard
                key={key.id}
                totpKey={key}
                isEditing={editId === key.id}
                editLabel={editLabel}
                editIssuer={editIssuer}
                onEditLabelChange={setEditLabel}
                onEditIssuerChange={setEditIssuer}
                onStartEdit={() => startEdit(key)}
                onSaveEdit={() => void handleEditSave(key.id)}
                onCancelEdit={() => setEditId(null)}
                onDelete={() => setDeleteTarget(key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Remove 2FA key"
        message={`Remove "${deleteTarget?.label}"? This cannot be undone. Make sure you no longer need this key before deleting it.`}
        confirmText="Remove"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════
   TOTP Key Card
   ═══════════════════════════════════════════════ */

interface TotpKeyCardProps {
  totpKey: TotpKey;
  isEditing: boolean;
  editLabel: string;
  editIssuer: string;
  onEditLabelChange: (v: string) => void;
  onEditIssuerChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function TotpKeyCard({
  totpKey,
  isEditing,
  editLabel,
  editIssuer,
  onEditLabelChange,
  onEditIssuerChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: TotpKeyCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white/[0.02] p-4 transition-colors',
        isEditing ? 'border-indigo-500/40' : 'border-white/[0.06] hover:border-white/10'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <KeyRound size={16} className="text-indigo-400" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Label / issuer row */}
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editLabel}
                onChange={(e) => onEditLabelChange(e.target.value)}
                placeholder="Label"
                className="h-7 text-sm"
              />
              <Input
                value={editIssuer}
                onChange={(e) => onEditIssuerChange(e.target.value)}
                placeholder="Issuer"
                className="h-7 text-sm"
              />
              <IconButton
                onClick={onSaveEdit}
                variant="ghost"
                size="sm"
                tooltip="Save"
                className="text-emerald-400 hover:text-emerald-300"
              >
                <Check size={14} />
              </IconButton>
              <IconButton
                onClick={onCancelEdit}
                variant="ghost"
                size="sm"
                tooltip="Cancel"
              >
                <X size={14} />
              </IconButton>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">
                {totpKey.label}
              </span>
              {totpKey.issuer && (
                <span className="text-xs text-slate-500 truncate">
                  · {totpKey.issuer}
                </span>
              )}
              {totpKey.accountId && (
                <Tooltip content="Linked to an account" side="top">
                  <Link2 size={12} className="text-indigo-400 shrink-0" />
                </Tooltip>
              )}
            </div>
          )}

          {/* TOTP code display */}
          {!isEditing && (
            <TotpBadge
              secret={totpKey.secret}
              period={totpKey.period}
              variant="full"
            />
          )}

          {/* Meta */}
          {!isEditing && (
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span>{totpKey.digits} digits</span>
              <span>·</span>
              <span>{totpKey.period}s period</span>
              <span>·</span>
              <span>{totpKey.algorithm}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            <IconButton
              onClick={onStartEdit}
              variant="ghost"
              size="sm"
              tooltip="Edit label"
            >
              <Pencil size={14} />
            </IconButton>
            <IconButton
              onClick={onDelete}
              variant="ghost"
              size="sm"
              tooltip="Remove key"
              className="text-slate-500 hover:text-red-400"
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
