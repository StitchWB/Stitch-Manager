import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  Key,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  RotateCw,
  Share2,
  User,
  Users,
  Globe,
  ShieldCheck,
  Check,
  X,
} from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { testCredentialConnection } from '@/lib/backend/modules/aiGateway';
import {
  groupsShareCredential,
  groupsUnshareCredential,
} from '@/lib/backend/modules/groups';
import { useGroupsStore } from '@/stores/groups';
import { useAuthStore } from '@/stores/auth';
import { Button, Badge, OverflowMenu, Modal, Checkbox } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

interface CredentialsListProps {
  endpoint: ProviderEndpoint;
  onAddCredential: () => void;
  onEditCredential: (credential: Credential) => void;
}

// ── Share-consent persistence (once per credential, ever) ───────────────────
const CONSENT_STORAGE_KEY = 'ai.groups.share.consented';

function readConsentedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter(v => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeConsentedSet(set: Set<string>): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage may be unavailable (private mode); consent is best-effort.
  }
}

// ── Scope chip cluster ──────────────────────────────────────────────────────
function ScopeChips({ credential, currentUserId }: {
  credential: Credential;
  currentUserId: string | number | null;
}) {
  const isMine =
    credential.ownerId != null &&
    currentUserId != null &&
    String(credential.ownerId) === String(currentUserId);
  const isLegacy = credential.ownerId == null;
  const groupNames = credential.sharedGroupNames ?? [];
  if (!isMine && groupNames.length === 0 && !isLegacy) return null;

  return (
    <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
      {isMine && (
        <Badge variant="info" size="sm" withDot>
          <User size={10} /> {t('ownership.mine')}
        </Badge>
      )}
      {groupNames.map((name, idx) => (
        <Badge key={`${name}-${idx}`} variant="indigo" size="sm" withDot>
          <Users size={10} /> {name}
        </Badge>
      ))}
      {isLegacy && (
        <Badge variant="slate" size="sm" withDot>
          <Globe size={10} /> {t('ownership.shared')}
        </Badge>
      )}
    </div>
  );
}

export function CredentialsList({ endpoint, onAddCredential, onEditCredential }: CredentialsListProps) {
  const { credentials, loading, errors, fetchCredentials, deleteCredential } = useAiGatewayStore();

  // ── Auth + groups (share flow) ────────────────────────────────────────────
  const authEnabled = useAuthStore(s => s.enabled);
  const currentUser = useAuthStore(s => s.user);
  const myGroups = useGroupsStore(s => s.groups);
  const fetchGroupsList = useGroupsStore(s => s.fetchList);

  const [sharePickerFor, setSharePickerFor] = useState<Credential | null>(null);
  const [shareDraft, setShareDraft] = useState<Set<string>>(new Set());
  const [shareBusy, setShareBusy] = useState(false);
  const [consentFor, setConsentFor] = useState<Credential | null>(null);
  const [consentAcked, setConsentAcked] = useState(false);

  useEffect(() => {
    fetchCredentials(endpoint.id);
  }, [endpoint.id, fetchCredentials]);

  const currentUserId = currentUser?.id ?? null;

  const handleDelete = useCallback(async (credential: Credential) => {
    const ok = await askConfirm({
      title: t('common.delete'),
      message: t('aiGateway.cred.deleteConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    await deleteCredential(credential.id);
  }, [deleteCredential]);

  const handleTest = useCallback(async (credential: Credential) => {
    try {
      const result = await testCredentialConnection(credential.id);
      if (result.success) {
        appToast.success(
          `Connection OK${result.latency_ms != null ? ` (${Math.round(result.latency_ms)}ms)` : ''}`,
          'ai-gateway'
        );
      } else {
        appToast.error(result.error || t('aiGateway.cred.connectionFailed'), 'ai-gateway');
      }
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('aiGateway.cred.testFailed'), 'ai-gateway');
    }
  }, []);

  const openSharePicker = useCallback(async (credential: Credential) => {
    setSharePickerFor(credential);
    setShareDraft(new Set(credential.sharedGroupIds ?? []));
    // Ensure my groups are loaded (picker needs them).
    if (authEnabled && myGroups.length === 0) {
      try {
        await fetchGroupsList();
      } catch {
        // best-effort; picker will show empty state
      }
    }
  }, [authEnabled, myGroups.length, fetchGroupsList]);

  const computeShareDelta = useCallback((credential: Credential, draft: Set<string>) => {
    const oldSet = new Set(credential.sharedGroupIds ?? []);
    const toShare = [...draft].filter(id => !oldSet.has(id));
    const toUnshare = [...oldSet].filter(id => !draft.has(id));
    return { toShare, toUnshare };
  }, []);

  const applyShare = useCallback(async (
    credential: Credential,
    toShare: string[],
    toUnshare: string[],
  ) => {
    setShareBusy(true);
    try {
      for (const groupId of toShare) {
        await groupsShareCredential({ credentialId: credential.id, groupId });
      }
      for (const groupId of toUnshare) {
        await groupsUnshareCredential({ credentialId: credential.id, groupId });
      }
      // Mark consented so the consent modal doesn't fire again for this credential.
      if (toShare.length > 0) {
        const consented = readConsentedSet();
        consented.add(credential.id);
        writeConsentedSet(consented);
      }
      await fetchCredentials(endpoint.id);
      const label = credential.label || credential.fingerprint.slice(0, 12);
      const groupName = toShare[0] ?? toUnshare[0] ?? '';
      appToast.success(
        t('ai.groups.share.success', { label, group: groupName }),
        'ai-gateway'
      );
      setSharePickerFor(null);
      setConsentFor(null);
      setConsentAcked(false);
    } catch (e) {
      appToast.error(
        t('ai.groups.share.failed', { msg: e instanceof Error ? e.message : String(e) }),
        'ai-gateway'
      );
    } finally {
      setShareBusy(false);
    }
  }, [endpoint.id, fetchCredentials]);

  const confirmSharePicker = useCallback(async () => {
    const credential = sharePickerFor;
    if (!credential) return;
    const { toShare, toUnshare } = computeShareDelta(credential, shareDraft);
    if (toShare.length === 0 && toUnshare.length === 0) {
      setSharePickerFor(null);
      return;
    }
    // Consent gate: first share of this credential (only when adding shares).
    const consented = readConsentedSet();
    if (!consented.has(credential.id) && toShare.length > 0) {
      // Close picker, open consent modal. The pending delta is recomputed on confirm.
      setSharePickerFor(null);
      setConsentFor(credential);
      setConsentAcked(false);
      return;
    }
    await applyShare(credential, toShare, toUnshare);
  }, [sharePickerFor, shareDraft, computeShareDelta, applyShare]);

  const confirmConsent = useCallback(async () => {
    const credential = consentFor;
    if (!credential || !consentAcked) return;
    const { toShare, toUnshare } = computeShareDelta(credential, shareDraft);
    await applyShare(credential, toShare, toUnshare);
  }, [consentFor, consentAcked, shareDraft, computeShareDelta, applyShare]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">{t('aiGateway.status.active')}</Badge>;
      case 'cooldown':
        return <Badge variant="warning">{t('aiGateway.status.cooldown')}</Badge>;
      case 'rate_limited':
        return <Badge variant="warning">{t('aiGateway.status.rateLimited')}</Badge>;
      case 'quota_exhausted':
        return <Badge variant="danger">{t('aiGateway.status.quotaExhausted')}</Badge>;
      case 'auth_failed':
        return <Badge variant="danger">{t('aiGateway.status.authFailed')}</Badge>;
      case 'degraded':
        return <Badge variant="warning">{t('aiGateway.status.degraded')}</Badge>;
      case 'disabled':
        return <Badge variant="default">{t('aiGateway.status.disabled')}</Badge>;
      default:
        return <Badge variant="outline">{t('aiGateway.status.unknown')}</Badge>;
    }
  };

  if (loading.credentials) {
    return <div className="p-4 text-center text-slate-400">{t('aiGateway.list.loadingCredentials')}</div>;
  }

  if (errors.credentials) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">{t('aiGateway.list.error')}: {errors.credentials}</div>
        <Button size="sm" variant="outline" onClick={() => fetchCredentials(endpoint.id)}>
          <RotateCw className="h-4 w-4 mr-2" />{t('aiGateway.list.retry')}
        </Button>
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <Key className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('aiGateway.list.noCredentials')}</h3>
        <p className="text-slate-400 mb-4">{t('aiGateway.list.noCredentialsDesc')}</p>
        <Button onClick={onAddCredential}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.cred.addTitle')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('aiGateway.list.credentialsTitle')} ({credentials.length})</h3>
        <Button size="sm" onClick={onAddCredential}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.cred.addTitle')}</Button>
      </div>

      {credentials.map(credential => {
        const isMine =
          credential.ownerId != null &&
          currentUserId != null &&
          String(credential.ownerId) === String(currentUserId);
        const canShare = authEnabled && isMine;

        return (
          <div
            key={credential.id}
            className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={() => onEditCredential(credential)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Key className="h-5 w-5 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-medium truncate">
                      {credential.label || credential.fingerprint.slice(0, 16)}
                    </h4>
                    {getStatusBadge(credential.runtimeStatus)}
                    {credential.enabled ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                    )}
                    <ScopeChips credential={credential} currentUserId={currentUserId} />
                  </div>
                  <div className="text-sm text-slate-400 truncate">
                    {credential.authType} • {credential.fingerprint.slice(0, 32)}...
                    {credential.consecutiveFailures > 0 && (
                      <span className="ml-2 text-amber-400">
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        {t('aiGateway.list.failures', { count: credential.consecutiveFailures })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <OverflowMenu
                  triggerLabel={t('common.more')}
                  items={[
                    {
                      id: 'share',
                      label: t('ai.groups.share.action'),
                      icon: <Share2 size={14} />,
                      onSelect: () => void openSharePicker(credential),
                      disabled: !canShare,
                    },
                    {
                      id: 'test',
                      label: t('aiGateway.cred.test'),
                      icon: <Zap size={14} />,
                      onSelect: () => void handleTest(credential),
                    },
                    {
                      id: 'delete',
                      label: t('common.delete'),
                      icon: <Trash2 size={14} />,
                      tone: 'danger' as const,
                      onSelect: () => void handleDelete(credential),
                    },
                  ]}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Share picker modal ─────────────────────────────────────────────── */}
      <Modal
        isOpen={sharePickerFor !== null}
        onClose={() => setSharePickerFor(null)}
        title={t('ai.groups.share.pickerTitle')}
        icon={<Share2 size={18} />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSharePickerFor(null)} disabled={shareBusy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmSharePicker()} disabled={shareBusy}>
              {shareBusy ? t('aiGateway.cred.saving') : t('ai.groups.share.consent.confirm')}
            </Button>
          </div>
        }
      >
        {myGroups.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">
            {t('ai.groups.empty.title')}
          </div>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {myGroups.map(group => {
              const checked = shareDraft.has(group.id);
              return (
                <Checkbox
                  key={group.id}
                  id={`share-group-${group.id}`}
                  label={group.name}
                  description={t('ai.groups.meta', { members: group.member_count, keys: group.key_count })}
                  checked={checked}
                  onChange={() => {
                    setShareDraft(prev => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </Modal>

      {/* ── Share consent modal (once per credential) ───────────────────────── */}
      <Modal
        isOpen={consentFor !== null}
        onClose={() => { setConsentFor(null); setConsentAcked(false); }}
        title={t('ai.groups.share.consent.title')}
        icon={<ShieldCheck size={18} />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setConsentFor(null); setConsentAcked(false); }} disabled={shareBusy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmConsent()} disabled={!consentAcked || shareBusy}>
              {shareBusy ? t('aiGateway.cred.saving') : t('ai.groups.share.consent.confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">{t('ai.groups.share.consent.body')}</p>
          <ul className="space-y-2 text-sm text-slate-400">
            <li className="flex items-start gap-2">
              <Check className="text-emerald-400 mt-0.5 shrink-0" size={14} />
              <span>{t('ai.groups.share.consent.canUse')}</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="text-red-400 mt-0.5 shrink-0" size={14} />
              <span>{t('ai.groups.share.consent.cannotSee')}</span>
            </li>
            <li className="flex items-start gap-2">
              <X className="text-red-400 mt-0.5 shrink-0" size={14} />
              <span>{t('ai.groups.share.consent.cannotEdit')}</span>
            </li>
          </ul>
          <Checkbox
            id="share-consent-ack"
            label={t('ai.groups.share.consent.acknowledge')}
            checked={consentAcked}
            onChange={() => setConsentAcked(prev => !prev)}
          />
        </div>
      </Modal>
    </div>
  );
}
