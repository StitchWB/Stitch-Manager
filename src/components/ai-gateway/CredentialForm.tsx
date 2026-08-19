import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import {
  groupsShareCredential,
} from '@/lib/backend/modules/groups';
import { useGroupsStore } from '@/stores/groups';
import { useAuthStore } from '@/stores/auth';
import { Button, Input, Select, Checkbox, Modal } from '@/components/ui';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

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
    // best-effort
  }
}

interface CredentialFormProps {
  endpoint: ProviderEndpoint;
  credential?: Credential | null;
  open: boolean;
  onClose: () => void;
  /** Group ids to pre-check in the "share with groups" checkbox list (create-only). */
  initialShareGroupIds?: string[];
  /** Fired after a successful create/update (before `onClose`). */
  onSuccess?: () => void;
}

export function CredentialForm({ endpoint, credential, open, onClose, initialShareGroupIds, onSuccess }: CredentialFormProps) {
  const { createCredential, updateCredential, rotateSecret } = useAiGatewayStore();

  const [label, setLabel] = useState(credential?.label || '');
  const [authType, setAuthType] = useState(credential?.authType || 'api_key');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(credential?.enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Share-to-groups (create-only, auth-gated) ────────────────────────────
  const authEnabled = useAuthStore(s => s.enabled);
  const myGroups = useGroupsStore(s => s.groups);
  const fetchGroupsList = useGroupsStore(s => s.fetchList);
  const [shareToGroups, setShareToGroups] = useState<Set<string>>(
    () => new Set(initialShareGroupIds ?? []),
  );
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentAcked, setConsentAcked] = useState(false);
  // Holds the created credential id + pending share list while consent is open.
  const [pendingShare, setPendingShare] = useState<{ id: string; label: string; groups: string[] } | null>(null);

  // Load my groups list when the form opens (auth enabled only) so the
  // share field can render immediately.
  useEffect(() => {
    if (open && authEnabled && myGroups.length === 0) {
      void fetchGroupsList().catch(() => { /* best-effort */ });
    }
  }, [open, authEnabled, myGroups.length, fetchGroupsList]);

  const applyShares = useCallback(async (credentialId: string, credLabel: string, groupIds: string[]) => {
    for (const groupId of groupIds) {
      await groupsShareCredential({ credentialId, groupId });
    }
    const consented = readConsentedSet();
    consented.add(credentialId);
    writeConsentedSet(consented);
    appToast.success(
      t('ai.groups.share.success', { label: credLabel, group: groupIds[0] ?? '' }),
      'ai-gateway'
    );
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      if (credential) {
        // Edit mode — no share field (shares are managed via the list's share picker).
        await updateCredential({ id: credential.id, label, enabled });
        if (secret) {
          await rotateSecret({ id: credential.id, newSecret: secret });
        }
        onSuccess?.();
        onClose();
      } else {
        // Create mode.
        if (!secret) throw new Error('Secret is required for new credentials');
        const created = await createCredential({ providerEndpointId: endpoint.id, label, authType, secret });
        const credLabel = label || created.fingerprint.slice(0, 12);
        const groupsToShare = [...shareToGroups];

        if (groupsToShare.length > 0) {
          // Consent gate: first share of this credential.
          const consented = readConsentedSet();
          if (!consented.has(created.id)) {
            // Stash pending operation and open consent modal; don't close the form yet.
            setPendingShare({ id: created.id, label: credLabel, groups: groupsToShare });
            setConsentOpen(true);
            setConsentAcked(false);
            return; // form stays open; consent modal handles the rest
          }
          await applyShares(created.id, credLabel, groupsToShare);
        }
        onSuccess?.();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const confirmConsent = useCallback(async () => {
    if (!consentAcked || !pendingShare) return;
    setLoading(true);
    setError(null);
    try {
      await applyShares(pendingShare.id, pendingShare.label, pendingShare.groups);
      setConsentOpen(false);
      setPendingShare(null);
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [consentAcked, pendingShare, applyShares, onClose, onSuccess]);

  const footer = (
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
      <Button disabled={loading} onClick={handleSubmit}>
        {loading ? t('aiGateway.cred.saving') : credential ? t('aiGateway.cred.update') : t('aiGateway.cred.create')}
      </Button>
    </div>
  );

  return (
    <>
      <Modal isOpen={open} onClose={onClose} title={credential ? t('aiGateway.cred.editTitle') : t('aiGateway.cred.addTitle')} size="sm" footer={footer}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t('aiGateway.cred.labelOptional')}</label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('aiGateway.cred.phLabel')} />
          </div>

          <div>
            <label className="text-sm font-medium">{t('aiGateway.cred.authType')}</label>
            <Select value={authType} onChange={e => setAuthType(e.target.value)} disabled={!!credential} required>
              <option value="api_key">{t('aiGateway.cred.optApiKey')}</option>
              <option value="oauth">{t('aiGateway.cred.optOAuth')}</option>
              <option value="session">{t('aiGateway.cred.optSession')}</option>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">
              {credential ? t('aiGateway.cred.secretNew') : t('aiGateway.cred.secret')}
            </label>
            <Input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder={credential ? t('aiGateway.cred.phKeep') : t('aiGateway.cred.phEnter')}
              required={!credential}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox id="cred-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <label htmlFor="cred-enabled" className="text-sm font-medium">{t('aiGateway.enabled')}</label>
          </div>

          {/* ── Share to groups (create-only, auth-gated) ───────────────────── */}
          {authEnabled && !credential && myGroups.length > 0 && (
            <div>
              <label className="text-sm font-medium">{t('ai.groups.share.action')}</label>
              <div className="space-y-1 mt-1 max-h-40 overflow-y-auto">
                {myGroups.map(group => (
                  <Checkbox
                    key={group.id}
                    id={`cred-share-${group.id}`}
                    label={group.name}
                    checked={shareToGroups.has(group.id)}
                    onChange={() => {
                      setShareToGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
      </Modal>

      {/* ── Share consent modal (once per credential) ───────────────────────── */}
      <Modal
        isOpen={consentOpen}
        onClose={() => { setConsentOpen(false); setConsentAcked(false); }}
        title={t('ai.groups.share.consent.title')}
        icon={<ShieldCheck size={18} />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setConsentOpen(false); setConsentAcked(false); }} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmConsent()} disabled={!consentAcked || loading}>
              {loading ? t('aiGateway.cred.saving') : t('ai.groups.share.consent.confirm')}
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
            id="cred-form-consent-ack"
            label={t('ai.groups.share.consent.acknowledge')}
            checked={consentAcked}
            onChange={() => setConsentAcked(prev => !prev)}
          />
        </div>
      </Modal>
    </>
  );
}
