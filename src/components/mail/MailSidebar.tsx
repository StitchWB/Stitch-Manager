import { Fragment, useMemo, useState } from 'react';
import {
  Archive,
  Cloud,
  FileText,
  Inbox,
  type LucideIcon,
  Mail as MailIcon,
  Mailbox,
  Pencil,
  Plus,
  Send,
  Server,
  ShieldAlert,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  ActionDialog,
  Badge,
  Button,
  ButtonBase,
  ConfirmDialog,
  EmptyState,
  Input,
  OverflowMenu,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import type { EmailFolder, EmailInboxProfile } from '@/lib/tauri/modules/emailInbox';
import type { MailProfileSyncState } from '@/stores/mail';
import { AUTO_REG_MAILBOX_PROFILE_ID } from '@/lib/mail/runtime';
import { detectMailboxProviderKind, type MailboxProviderKind } from '@/lib/mail/providerPresets';
import { MailSidebarAccounts } from './MailSidebarAccounts';
import { AddMailboxModal, type AddMailboxSource } from './AddMailboxModal';

type AddMailboxAction =
  | 'icloud'
  | 'gmail'
  | 'fromAutoReg'
  | 'imapManual'
  | 'mailTmManual'
  | 'fromSheets';

interface MailSidebarProps {
  profiles: EmailInboxProfile[];
  activeProfileId: string | null;
  /** Current ?account=<id> deep-link value, if any. */
  activeAccountId?: number | null;
  profileSyncMap: Record<string, MailProfileSyncState>;
  availableFolders: EmailFolder[];
  selectedFolder: EmailFolder | null;
  hasSession: boolean;
  isConnecting: boolean;
  isProfilesLoading: boolean;
  onSelectProfile: (profileId: string | null) => void;
  onSelectFolder: (folder: EmailFolder | null) => Promise<void> | void;
  onAddMailbox: (action: AddMailboxAction) => void;
  onRenameProfile: (profileId: string, nextLabel: string) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
}

const FOLDER_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
  all: Mailbox,
  folder: Mailbox,
};

const KIND_LABEL_KEYS: Record<string, string> = {
  inbox: 'mail.folderInbox',
  sent: 'mail.folderSent',
  drafts: 'mail.folderDrafts',
  trash: 'mail.folderTrash',
  spam: 'mail.folderSpam',
  archive: 'mail.folderAllMail',
  all: 'mail.folderAllMail',
};

const GROUP_ICONS: Record<MailboxProviderKind, LucideIcon> = {
  icloud: Cloud,
  gmail: MailIcon,
  imap: Server,
  mail_tm: Send,
};

const GROUP_LABEL_KEYS: Record<MailboxProviderKind, string> = {
  icloud: 'mail.groupICloud',
  gmail: 'mail.groupGmail',
  imap: 'mail.groupImap',
  mail_tm: 'mail.groupMailTm',
};

const GROUP_ORDER: MailboxProviderKind[] = ['icloud', 'gmail', 'imap', 'mail_tm'];

function pickFolderIcon(folder: EmailFolder): LucideIcon {
  return FOLDER_ICONS[folder.kind] ?? Mailbox;
}

function getFolderLabel(folder: EmailFolder): string {
  // Localised name for SPECIAL-USE folders.
  if (folder.kind !== 'folder') {
    const key = KIND_LABEL_KEYS[folder.kind];
    if (key) return t(key);
  }
  // Use the leaf name (already computed from delimiter on the backend)
  return folder.name || folder.path;
}

function getFolderDepth(folder: EmailFolder): number {
  const delim = folder.delimiter;
  if (!delim) return 0;
  // Count delimiter occurrences in path. This is a fast approximation; if a
  // server uses multi-character delimiters they'll still count as one segment.
  let depth = 0;
  let from = 0;
  while (true) {
    const idx = folder.path.indexOf(delim, from);
    if (idx < 0) break;
    depth += 1;
    from = idx + delim.length;
  }
  return depth;
}

function getProfileBadgeTone(
  sync: MailProfileSyncState | null | undefined
): 'outline' | 'success' | 'danger' | 'info' {
  if (!sync) return 'outline';
  if (sync.status === 'syncing') return 'info';
  if (sync.status === 'error') return 'danger';
  return 'success';
}

function formatRelativeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

const ADD_SOURCE_TO_ACTION: Record<AddMailboxSource, AddMailboxAction> = {
  icloud: 'icloud',
  gmail: 'gmail',
  imap: 'imapManual',
  fromAutoReg: 'fromAutoReg',
  fromSheets: 'fromSheets',
  mailTmManual: 'mailTmManual',
};

export function MailSidebar({
  profiles,
  activeProfileId,
  activeAccountId,
  profileSyncMap,
  availableFolders,
  selectedFolder,
  hasSession,
  isConnecting,
  isProfilesLoading,
  onSelectProfile,
  onSelectFolder,
  onAddMailbox,
  onRenameProfile,
  onDeleteProfile,
}: MailSidebarProps) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<EmailInboxProfile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmailInboxProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const groupedProfiles = useMemo(() => {
    const groups = new Map<MailboxProviderKind, EmailInboxProfile[]>();
    for (const profile of profiles) {
      const kind = detectMailboxProviderKind(profile);
      const bucket = groups.get(kind) ?? [];
      bucket.push(profile);
      groups.set(kind, bucket);
    }
    for (const bucket of groups.values()) {
      bucket.sort((a, b) => a.label.localeCompare(b.label));
    }
    return GROUP_ORDER.filter(kind => groups.has(kind)).map(kind => ({
      kind,
      profiles: groups.get(kind) ?? [],
    }));
  }, [profiles]);

  const selectedFolderPath = selectedFolder?.path.trim().toLowerCase() ?? '';

  const folderOptions = useMemo(() => {
    if (availableFolders.length === 0) {
      return [];
    }

    const order: Record<string, number> = {
      inbox: 0,
      sent: 1,
      drafts: 2,
      spam: 3,
      trash: 4,
      archive: 5,
      all: 6,
      folder: 10,
    };

    return [...availableFolders].sort((a, b) => {
      const oa = order[a.kind] ?? 10;
      const ob = order[b.kind] ?? 10;
      if (oa !== ob) return oa - ob;
      return a.path.localeCompare(b.path);
    });
  }, [availableFolders]);

  const handleAddModalSelect = (source: AddMailboxSource) => {
    setAddModalOpen(false);
    onAddMailbox(ADD_SOURCE_TO_ACTION[source]);
  };

  const openRenameDialog = (profile: EmailInboxProfile) => {
    setRenameTarget(profile);
    setRenameValue(profile.label);
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const nextLabel = renameValue.trim();
    if (!nextLabel) return;

    setRenameBusy(true);
    try {
      await onRenameProfile(renameTarget.id, nextLabel);
      setRenameTarget(null);
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await onDeleteProfile(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <aside className="bg-white/[0.03] border border-white/[0.08] rounded-xl flex flex-col h-full min-h-0">
      {/* Accounts group */}
      <div className="max-h-[45%] overflow-y-auto">
        <MailSidebarAccounts
          profiles={profiles}
          activeAccountId={activeAccountId ?? null}
        />
      </div>

      {/* Mailboxes group */}
      <section className="p-3 flex-1 min-h-0 flex flex-col">
        <header className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-white">
            <Mailbox size={14} />
            <h2 className="text-[11px] font-semibold uppercase tracking-wide">
              {t('mail.sidebarMailboxesTitle')}
            </h2>
          </div>
          <Badge size="sm" variant="outline">
            {profiles.length}
          </Badge>
        </header>

        {isProfilesLoading ? (
          <p className="text-[11px] text-slate-500 px-1">{t('mail.profilesLoading')}</p>
        ) : null}

        {!isProfilesLoading && profiles.length === 0 ? (
          <EmptyState
            icon={Mailbox}
            title={t('mail.sidebarProfilesEmpty')}
            description={t('mail.sidebarProfilesEmptyHint')}
            className="py-6"
          />
        ) : null}

        <div className="space-y-3 overflow-auto pr-1 -mr-1">
          {groupedProfiles.map(group => {
            const GroupIcon = GROUP_ICONS[group.kind];
            return (
              <div key={group.kind} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 text-slate-500">
                  <GroupIcon size={11} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {t(GROUP_LABEL_KEYS[group.kind])}
                  </span>
                  <span className="text-[10px] text-slate-600">({group.profiles.length})</span>
                </div>

                {group.profiles.map(profile => {
                  const sync = profileSyncMap[profile.id] ?? null;
                  const selected = profile.id === activeProfileId;
                  const tone = getProfileBadgeTone(sync);
                  const lastSync = formatRelativeTime(sync?.lastSyncAt);
                  const isAutoReg = profile.id === AUTO_REG_MAILBOX_PROFILE_ID;

                  return (
                    <Fragment key={profile.id}>
                      <div
                        className={`group w-full rounded-lg border px-2.5 py-2 transition-colors ${selected
                            ? 'border-indigo-400/50 bg-indigo-500/10 text-white'
                            : 'border-white/10 bg-black/20 text-slate-200 hover:border-white/20 hover:bg-black/30'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <ButtonBase
                            type="button"
                            onClick={() => onSelectProfile(profile.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              {isAutoReg ? (
                                <Wand2 size={11} className="text-indigo-300 shrink-0" />
                              ) : null}
                              <p className="text-xs font-medium text-white truncate">
                                {profile.label}
                              </p>
                            </div>
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                              {profile.accountId}
                            </p>
                          </ButtonBase>

                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant={tone} size="sm" withDot={tone !== 'outline'}>
                              {profile.provider === 'imap' ? 'IMAP' : 'Mail.tm'}
                            </Badge>
                            <OverflowMenu
                              size="sm"
                              triggerLabel={t('common.more')}
                              className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                              items={[
                                {
                                  id: 'rename',
                                  label: t('mail.renameProfileAction'),
                                  icon: <Pencil size={12} />,
                                  onSelect: () => openRenameDialog(profile),
                                },
                                {
                                  id: 'delete',
                                  label: t('mail.deleteProfileAction'),
                                  icon: <Trash2 size={12} />,
                                  tone: 'danger',
                                  onSelect: () => setDeleteTarget(profile),
                                },
                              ]}
                            />
                          </div>
                        </div>
                        {selected && lastSync ? (
                          <p className="text-[10px] text-slate-500 mt-1.5">
                            {t('mail.lastSyncedAt', { time: lastSync })}
                          </p>
                        ) : null}
                      </div>

                      {/* Folders nested under the selected profile */}
                      {selected && hasSession && folderOptions.length > 0 ? (
                        <div className="pl-3 mt-1 space-y-0.5">
                          {folderOptions.map(folder => {
                            const Icon = pickFolderIcon(folder);
                            const folderActive =
                              folder.path.trim().toLowerCase() === selectedFolderPath;
                            const depth = getFolderDepth(folder);
                            const label = getFolderLabel(folder);
                            return (
                              <ButtonBase
                                key={folder.id}
                                type="button"
                                disabled={isConnecting}
                                onClick={() => {
                                  void onSelectFolder(folder);
                                }}
                                className={`w-full text-left rounded-md px-2 py-1.5 transition-colors flex items-center gap-2 ${folderActive
                                    ? 'bg-indigo-500/15 text-white'
                                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                  } disabled:opacity-50`}
                                style={depth > 0 ? { paddingLeft: 8 + depth * 12 } : undefined}
                                title={folder.path}
                              >
                                <Icon size={12} />
                                <span className="text-[11px] truncate">{label}</span>
                              </ButtonBase>
                            );
                          })}
                        </div>
                      ) : null}

                      {selected && !hasSession ? (
                        <p className="text-[10px] text-slate-600 px-2 py-1 italic">
                          {t('mail.foldersDisconnectedHint')}
                        </p>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      {/* Add mailbox entry point */}
      <div className="p-3 border-t border-white/[0.06]">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          leftIcon={<Plus size={14} />}
          onClick={() => setAddModalOpen(true)}
        >
          {t('mail.addMailboxAction')}
        </Button>
      </div>

      <AddMailboxModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSelect={handleAddModalSelect}
      />

      <ActionDialog
        isOpen={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        onSubmit={() => {
          void handleRenameSubmit();
        }}
        title={t('mail.renameProfileDialogTitle')}
        description={t('mail.renameProfileDialogDescription')}
        mode="edit"
        confirmText={t('common.save')}
        cancelText={t('common.cancel')}
        isLoading={renameBusy}
        submitDisabled={!renameValue.trim()}
      >
        <Input
          label={t('mail.renameProfileLabel')}
          value={renameValue}
          onChange={event => setRenameValue(event.target.value)}
          autoFocus
        />
      </ActionDialog>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
        title={t('mail.deleteProfileDialogTitle')}
        message={t('mail.deleteProfileDialogDescription', { label: deleteTarget?.label ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={deleteBusy}
      />
    </aside>
  );
}

export type { AddMailboxAction };
