import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useGroupsStore } from '../stores/groups';
import { GroupsList } from '../components/ai-groups/GroupsList';
import { GroupDetail } from '../components/ai-groups/GroupDetail';
import { InviteBanner } from '../components/ai-groups/InviteBanner';
import { CreateGroupModal } from '../components/ai-groups/CreateGroupModal';
import { Modal, Select } from '@/components/ui';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { t } from '../lib/i18n';

interface AiGroupsPageProps {
  /** Controlled by the parent header's "Create Group" action. */
  createGroupOpen: boolean;
  setCreateGroupOpen: (open: boolean) => void;
}

/**
 * Groups tab content extracted from AiProviders.tsx (P1.2).
 *
 * Renders the InviteBanner, responsive master-detail (GroupsList + GroupDetail),
 * and the create-group / how-to-get modals. All data is read from stores;
 * `createGroupOpen` is controlled by the parent because the trigger button
 * lives in the shared PageHeader actions slot.
 */
export default function AiGroupsPage({
  createGroupOpen,
  setCreateGroupOpen,
}: AiGroupsPageProps) {
  const authEnabled = useAuthStore(state => state.enabled);
  const currentUser = useAuthStore(state => state.user);
  const groupsStore = useGroupsStore();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [howToGetOpen, setHowToGetOpen] = useState(false);

  // Responsive breakpoints for the groups master-detail layout.
  // <md: drill-down (list OR detail). md..lg: Select dropdown + detail. >=lg: two-column.
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const isLgUp = useMediaQuery('(min-width: 1024px)');

  // Fetch groups list when entering the groups tab. NOTE: depend on the
  // STABLE action selector, NOT the whole store object — the store state
  // gets a new ref on every update (loading flags), which re-triggered this
  // effect in an infinite fetch loop (React #185, caught by e2e).
  const fetchGroupsList = useGroupsStore(s => s.fetchList);
  useEffect(() => {
    if (!authEnabled) return;
    void fetchGroupsList();
  }, [authEnabled, fetchGroupsList]);

  // Auto-select the first group when the list loads and nothing is selected.
  useEffect(() => {
    if (!authEnabled) return;
    if (selectedGroupId === null && groupsStore.groups.length > 0) {
      // Deferred: repo lint rule forbids synchronous setState in effects.
      queueMicrotask(() => setSelectedGroupId(groupsStore.groups[0].id));
    }
  }, [authEnabled, selectedGroupId, groupsStore.groups]);

  return (
    <>
      <InviteBanner
        invites={groupsStore.invites}
        onResolved={() => {
          void groupsStore.fetchList();
        }}
      />
      {isLgUp ? (
        // >=lg: two-column master-detail (desktop).
        <div className="flex flex-row gap-3 h-full min-h-0">
          <div className="w-[320px] shrink-0 h-full min-h-0">
            <GroupsList
              selectedId={selectedGroupId}
              onSelect={setSelectedGroupId}
              onCreate={() => setCreateGroupOpen(true)}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0">
            {selectedGroupId ? (
              <GroupDetail
                groupId={selectedGroupId}
                currentUserId={
                  currentUser?.id != null ? String(currentUser.id) : null
                }
                onBack={() => setSelectedGroupId(null)}
                onDeleted={() => {
                  setSelectedGroupId(null);
                  void groupsStore.fetchList();
                }}
                onLeft={() => {
                  setSelectedGroupId(null);
                  void groupsStore.fetchList();
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                {t('ai.groups.empty.title')}
              </div>
            )}
          </div>
        </div>
      ) : isMdUp ? (
        // md..lg: Select-driven dropdown above the detail pane.
        <div className="flex flex-col gap-3 h-full min-h-0">
          <div className="shrink-0">
            <Select
              value={selectedGroupId ?? ''}
              onValueChange={(val) => setSelectedGroupId(val || null)}
              options={groupsStore.groups.map(g => ({ value: g.id, label: g.name }))}
              placeholder={t('ai.groups.selectGroup')}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0">
            {selectedGroupId ? (
              <GroupDetail
                groupId={selectedGroupId}
                currentUserId={
                  currentUser?.id != null ? String(currentUser.id) : null
                }
                onBack={() => setSelectedGroupId(null)}
                onDeleted={() => {
                  setSelectedGroupId(null);
                  void groupsStore.fetchList();
                }}
                onLeft={() => {
                  setSelectedGroupId(null);
                  void groupsStore.fetchList();
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                {t('ai.groups.empty.title')}
              </div>
            )}
          </div>
        </div>
      ) : (
        // <md: drill-down — list OR detail, with back button.
        <div className="h-full min-h-0">
          {selectedGroupId ? (
            <GroupDetail
              groupId={selectedGroupId}
              currentUserId={
                currentUser?.id != null ? String(currentUser.id) : null
              }
              onBack={() => setSelectedGroupId(null)}
              onDeleted={() => {
                setSelectedGroupId(null);
                void groupsStore.fetchList();
              }}
              onLeft={() => {
                setSelectedGroupId(null);
                void groupsStore.fetchList();
              }}
            />
          ) : (
            <GroupsList
              selectedId={selectedGroupId}
              onSelect={setSelectedGroupId}
              onCreate={() => setCreateGroupOpen(true)}
            />
          )}
        </div>
      )}

      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        onTierError={() => setHowToGetOpen(true)}
      />
      <Modal
        isOpen={howToGetOpen}
        onClose={() => setHowToGetOpen(false)}
        title={t('scenarios.howToGetTier', { tier: t('auth.role.vip') })}
        icon={<HelpCircle size={18} />}
        size="sm"
      >
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex items-start gap-2">
            <span className="text-slate-500 mt-0.5">•</span>
            <span>{t('scenarios.howToGetTierSubscribe')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-slate-500 mt-0.5">•</span>
            <span>{t('scenarios.howToGetTierAskAdmin')}</span>
          </li>
        </ul>
      </Modal>
    </>
  );
}
