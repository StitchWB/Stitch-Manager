import { ClipboardPaste, Plus, Zap } from 'lucide-react';

import { Button, OverflowMenu } from '@/components/ui';
import type { OverflowMenuItem } from '@/components/ui/OverflowMenu';
import { t } from '@/lib/i18n';

export interface AddProviderMenuProps {
  busy: boolean;
  onPasteKeys: () => void;
  onAddManually: () => void;
  onImportOpencode: () => void;
  onImportPackage: () => void;
}

export function AddProviderMenu(props: AddProviderMenuProps): JSX.Element {
  const { busy, onPasteKeys, onAddManually, onImportOpencode, onImportPackage } = props;

  const items: OverflowMenuItem[] = [
    {
      id: 'manual',
      label: t('aiHub.providersPage.addManually'),
      icon: <Plus size={14} />,
      onSelect: onAddManually,
      disabled: busy,
    },
    {
      id: 'opencode',
      label: t('aiHub.providersPage.importOpencode'),
      icon: <Zap size={14} />,
      onSelect: onImportOpencode,
      disabled: busy,
    },
    {
      id: 'package',
      label: t('aiHub.providersPage.importPackage'),
      icon: <ClipboardPaste size={14} />,
      onSelect: onImportPackage,
      disabled: busy,
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        leftIcon={<ClipboardPaste size={14} />}
        onClick={onPasteKeys}
      >
        {t('aiHub.providersPage.pasteKeys')}
      </Button>
      <OverflowMenu triggerLabel={t('common.more')} items={items} />
    </div>
  );
}
