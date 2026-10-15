import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  HeartHandshake,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Crown,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { BadgeChip } from '../components/friends/BadgeChip';
import { ChannelLogo } from '../components/friends/ChannelLogo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Tooltip } from '@/components/ui/Tooltip';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t } from '@/lib/i18n';
import { useAppStore } from '../stores/app';
import {
  listCommunityChannels,
  createCommunityChannel,
  updateCommunityChannel,
  deleteCommunityChannel,
  type ChannelItem,
  type ChannelForm,
  type ChannelType,
  type ChannelBadge,
} from '../lib/backend/modules/communityChannels';

const TYPE_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'github', label: 'GitHub' },
  { value: 'other', label: 'Other' },
];

const BADGE_OPTIONS: { value: NonNullable<ChannelBadge>; label: string }[] = [
  { value: 'friend', label: 'friend' },
  { value: 'partner', label: 'partner' },
  { value: 'official', label: 'official' },
];

interface FormModalProps {
  channel: ChannelItem | null; // null = create mode
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function ChannelFormModal({ channel, onClose, onSaved }: FormModalProps) {
  const [title, setTitle] = useState(channel?.title ?? '');
  const [url, setUrl] = useState(channel?.url ?? '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [logoUrl, setLogoUrl] = useState(channel?.logo_url ?? '');
  const [type, setType] = useState<ChannelType>(channel?.type ?? 'telegram');
  const [badge, setBadge] = useState<NonNullable<ChannelBadge>>(channel?.badge ?? 'friend');
  const [active, setActive] = useState(channel?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);

    if (!title.trim() || !url.trim()) {
      setFormError('friends.admin.errorValidation');
      return;
    }

    const form: ChannelForm = {
      title: title.trim(),
      url: url.trim(),
      description: description.trim() || null,
      logo_url: logoUrl.trim() || null,
      type,
      badge,
      active,
    };

    setSaving(true);
    try {
      if (channel) {
        await updateCommunityChannel(channel.id, form);
        toast.success(t('friends.admin.updated'));
      } else {
        await createCommunityChannel(form);
        toast.success(t('friends.admin.created'));
      }
      onClose();
      await onSaved();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('friends.admin.saveFailed');
      setFormError(null);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={channel ? t('friends.admin.editTitle') : t('friends.admin.createTitle')}
      icon={<HeartHandshake size={18} />}
      size="md"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('friends.admin.fieldTitle')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            autoComplete="off"
            required
          />
          <Input
            label={t('friends.admin.fieldUrl')}
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://t.me/..."
            autoComplete="off"
            required
          />
        </div>

        <Textarea
          label={t('friends.admin.fieldDescription')}
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label={t('friends.admin.fieldType')}
            value={type}
            onValueChange={v => setType(v as ChannelType)}
            options={TYPE_OPTIONS}
          />
          <Select
            label={t('friends.admin.fieldBadge')}
            value={badge}
            onValueChange={v => setBadge(v as NonNullable<ChannelBadge>)}
            options={BADGE_OPTIONS}
          />
        </div>

        <Input
          label={t('friends.admin.fieldLogoUrl')}
          value={logoUrl}
          onChange={e => setLogoUrl(e.target.value)}
          placeholder="https://..."
          autoComplete="off"
        />

        <Toggle
          label={t('friends.admin.fieldActive')}
          checked={active}
          onChange={setActive}
        />

        {formError && (
          <div
            role="alert"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-relaxed">{t(formError)}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('friends.admin.cancel')}
          </Button>
          <Button type="submit" variant="primary" isLoading={saving} disabled={saving}>
            {saving ? t('friends.admin.saving') : t('friends.admin.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface AdminSectionProps {
  channels: ChannelItem[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onEdit: (channel: ChannelItem) => void;
  onCreate: () => void;
  onDelete: (channel: ChannelItem) => void;
}

function ChannelAdminSection({
  channels,
  loading,
  error,
  onRefresh,
  onEdit,
  onCreate,
  onDelete,
}: AdminSectionProps) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Crown className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              {t('friends.admin.title')}
            </h2>
            <p className="text-[11px] text-slate-500 truncate">{t('friends.admin.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {loading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
          <Button
            variant="primary"
            size="sm"
            onClick={onCreate}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            {t('friends.admin.add')}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="p-6 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <p className="text-sm text-slate-400 max-w-md">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => void onRefresh()}>
            {t('radar.retry')}
          </Button>
        </div>
      ) : channels.length === 0 && !loading ? (
        <div className="p-10 text-center">
          <HeartHandshake className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('friends.admin.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b border-white/[0.06] text-left">
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('friends.admin.colTitle')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('friends.admin.colDescription')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('friends.admin.colUrl')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28">
                  {t('friends.admin.colBadge')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">
                  {t('friends.admin.colStatus')}
                </TableHead>
                <TableHead className="px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wider w-28 text-right">
                  {t('friends.admin.colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map(ch => (
                <TableRow
                  key={ch.id}
                  className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <TableCell className="px-5 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ChannelLogo
                        src={ch.logo_url}
                        type={ch.type}
                        className="w-7 h-7 rounded-full text-slate-400"
                        iconSize={14}
                      />
                      <div className="text-slate-200 font-medium truncate">{ch.title}</div>
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    {ch.description ? (
                      <div className="text-slate-400 text-xs max-w-[280px] truncate">
                        {ch.description}
                      </div>
                    ) : (
                      <span className="text-slate-600 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <div className="text-slate-400 text-xs max-w-[200px] truncate">{ch.url}</div>
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    {ch.badge ? (
                      <BadgeChip badge={ch.badge} />
                    ) : (
                      <span className="text-slate-600 text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-5 py-3">
                    <Badge
                      variant={ch.active ? 'success' : 'default'}
                      size="sm"
                      withDot
                      className="normal-case"
                    >
                      {ch.active ? t('friends.admin.statusActive') : t('friends.admin.statusInactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip content={t('friends.admin.edit')} side="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(ch)}
                          leftIcon={<Pencil className="w-3.5 h-3.5" />}
                          className="text-slate-500 hover:text-indigo-400"
                          aria-label={t('friends.admin.edit')}
                        />
                      </Tooltip>
                      <Tooltip content={t('friends.admin.delete')} side="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(ch)}
                          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                          className="text-slate-500 hover:text-red-400"
                          aria-label={t('friends.admin.delete')}
                        />
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type FormTarget = { mode: 'create' } | { mode: 'edit'; channel: ChannelItem };

export default function PartnerChannels() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  const refreshChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChannels(await listCommunityChannels());
    } catch (err) {
      setError(
        err instanceof Error && err.message ? err.message : t('friends.admin.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshChannels();
  }, [refreshChannels]);

  const onDelete = async (channel: ChannelItem) => {
    const confirmed = await askConfirm({
      title: t('friends.admin.deleteTitle'),
      message: t('friends.admin.deleteMessage', { title: channel.title }),
      confirmText: t('friends.admin.deleteConfirm'),
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteCommunityChannel(channel.id);
      toast.success(t('friends.admin.deleted'));
      await refreshChannels();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : t('friends.admin.deleteFailed'),
      );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('friends.admin.pageTitle')}
        subtitle={t('friends.admin.pageSubtitle')}
        icon={<HeartHandshake size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto">
          <ChannelAdminSection
            channels={channels}
            loading={loading}
            error={error}
            onRefresh={refreshChannels}
            onCreate={() => setFormTarget({ mode: 'create' })}
            onEdit={channel => setFormTarget({ mode: 'edit', channel })}
            onDelete={channel => void onDelete(channel)}
          />
        </div>
      </div>

      {formTarget && (
        <ChannelFormModal
          channel={formTarget.mode === 'edit' ? formTarget.channel : null}
          onClose={() => setFormTarget(null)}
          onSaved={refreshChannels}
        />
      )}
    </div>
  );
}
