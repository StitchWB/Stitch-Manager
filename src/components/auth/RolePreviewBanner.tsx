/**
 * RolePreviewBanner — slim full-width strip shown at the very top of the
 * app while an admin is previewing another role. Renders ONLY when auth
 * is enabled, the real user is an admin, and a preview_role is active.
 *
 * Shows the current (previewed) role, a role selector to switch the
 * preview, and an exit button. Errors from setPreviewRole are surfaced
 * via sonner toast. Lives in Layout, outside Routes, so it stays visible
 * on every page including AdminRoute-guarded pages.
 */

import { Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/auth';
import { t } from '@/lib/i18n';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';

const PREVIEW_ROLES = ['user', 'vip', 'premium', 'elite', 'admin'] as const;
type PreviewRole = (typeof PREVIEW_ROLES)[number];

export function RolePreviewBanner() {
  const enabled = useAuthStore(state => state.enabled);
  const user = useAuthStore(state => state.user);
  const setPreviewRole = useAuthStore(state => state.setPreviewRole);

  // Render only for a real admin with an active preview.
  if (!enabled || !user || user.role !== 'admin' || !user.preview_role) {
    return null;
  }

  const previewRole = user.preview_role as PreviewRole;

  const handleValueChange = async (value: string) => {
    try {
      // 'admin' exits the preview (returns to the real admin role).
      await setPreviewRole(value === 'admin' ? null : value);
    } catch (err) {
      toast.error(t('auth.preview.error'));
      // Re-throw so callers/tests can observe the failure; the toast is
      // the user-facing surface.
      throw err;
    }
  };

  const handleExit = async () => {
    try {
      await setPreviewRole(null);
    } catch (err) {
      toast.error(t('auth.preview.error'));
      throw err;
    }
  };

  return (
    <div
      className="w-full flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-200 shrink-0"
      role="status"
      data-testid="role-preview-banner"
    >
      <Eye className="w-4 h-4 shrink-0" />
      <span className="text-xs font-medium truncate">
        {t('auth.preview.banner', { role: t(`auth.role.${previewRole}`) })}
      </span>
      <div className="flex-1" />
      <DropdownMenu
        value={previewRole}
        onValueChange={handleValueChange}
        options={PREVIEW_ROLES.map(r => ({
          value: r,
          label: r === 'admin' ? t('auth.preview.myRole') : t(`auth.role.${r}`),
        }))}
        triggerIcon={<Eye className="w-3 h-3" />}
        buttonClassName="border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
        menuClassName="border-amber-500/20"
      />
      <Tooltip content={t('auth.preview.exit')} side="bottom">
        <IconButton
          onClick={handleExit}
          size="sm"
          variant="ghost"
          aria-label={t('auth.preview.exit')}
          className="text-amber-300 hover:text-amber-100 hover:bg-amber-500/10"
        >
          <X className="w-3.5 h-3.5" />
        </IconButton>
      </Tooltip>
    </div>
  );
}

export default RolePreviewBanner;
