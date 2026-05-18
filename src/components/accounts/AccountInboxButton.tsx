import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, LoadingSpinner, Tooltip } from '@/components/ui';
import {
  emailInboxListProfiles,
  type EmailInboxProfile,
} from '@/lib/tauri/modules/emailInbox';
import { resolveMailboxProfileForAccount } from '@/lib/mail/runtime';
import { t } from '@/lib/i18n';

export interface AccountInboxButtonProps {
  account: {
    id: number;
    email: string;
    metadata?: string | null;
    provider: string;
  };
  /**
   * Profiles already loaded by the parent. When omitted the button loads
   * its own copy on mount. Passing a shared list from a parent is preferred
   * to avoid N×listProfiles fetches when rendering many rows.
   */
  profiles?: EmailInboxProfile[];
  size?: 'xs' | 'sm';
  variant?: 'primary' | 'secondary' | 'ghost';
}

/**
 * Compact action button that resolves the right mailbox profile for an
 * account (via resolveMailboxProfileForAccount) and deep-links to the Mail
 * page with `?account=<id>` so it can apply the correct profile + filter.
 *
 * Shows a small loading spinner while profiles are being fetched, a tooltip
 * with the resolved mailbox label on success, and a disabled state with
 * the appropriate hint when no profile can be matched.
 */
export function AccountInboxButton({
  account,
  profiles: providedProfiles,
  size = 'sm',
  variant = 'secondary',
}: AccountInboxButtonProps) {
  const navigate = useNavigate();
  const [internalProfiles, setInternalProfiles] = useState<EmailInboxProfile[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load profiles ourselves only when the parent did not pass them in.
  useEffect(() => {
    if (providedProfiles !== undefined) {
      // Parent owns the data — stay in "use providedProfiles" mode.
      setInternalProfiles(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void emailInboxListProfiles()
      .then(list => {
        if (cancelled) return;
        setInternalProfiles(list);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('[AccountInboxButton] Failed to load mailbox profiles:', error);
        setInternalProfiles([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providedProfiles]);

  const profiles = providedProfiles ?? internalProfiles ?? [];

  const resolution = useMemo(
    () =>
      resolveMailboxProfileForAccount(
        {
          email: account.email,
          metadata: account.metadata,
          provider: account.provider,
        },
        profiles
      ),
    [account.email, account.metadata, account.provider, profiles]
  );

  const isDataReady = providedProfiles !== undefined || internalProfiles !== null;
  const profile = resolution.profile;
  const hasProfile = Boolean(profile);

  const handleOpen = () => {
    if (!hasProfile) return;
    navigate(`/mail?account=${account.id}`);
  };

  // While loading, show a non-interactive button with a spinner so the row
  // height doesn't jump.
  if (isLoading || !isDataReady) {
    return (
      <Button
        size={size}
        variant={variant}
        disabled
        leftIcon={<LoadingSpinner size="sm" color="inherit" />}
      >
        {t('mail.openInboxAction')}
      </Button>
    );
  }

  const tooltipContent = hasProfile && profile
    ? t('mail.openInboxTooltipResolved', { label: profile.label })
    : t('mail.openInboxTooltipMissing');

  return (
    <Tooltip content={tooltipContent} side="top">
      <Button
        size={size}
        variant={variant}
        onClick={handleOpen}
        disabled={!hasProfile}
        leftIcon={<Inbox size={size === 'xs' ? 12 : 14} />}
        aria-label={t('mail.openInboxAction')}
      >
        {t('mail.openInboxAction')}
      </Button>
    </Tooltip>
  );
}

export default AccountInboxButton;
