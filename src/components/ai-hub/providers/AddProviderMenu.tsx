import { ClipboardPaste, Download, Zap } from 'lucide-react';

import { Button, OverflowMenu } from '@/components/ui';
import type { OverflowMenuItem } from '@/components/ui/OverflowMenu';
import { t } from '@/lib/i18n';

export interface AddProviderMenuProps {
  busy: boolean;
  onAddConnection: () => void;
  onImportOpencode: () => void;
  onImportPackage: () => void;
}

export function AddProviderMenu(props: AddProviderMenuProps): JSX.Element {
  const { busy, onAddConnection, onImportOpencode, onImportPackage } = props;

  const items: OverflowMenuItem[] = [
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
      icon: <Download size={14} />,
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
        onClick={onAddConnection}
      >
        {t('aiHub.providersPage.addConnection')}
      </Button>
      <OverflowMenu triggerLabel={t('common.more')} items={items} />
    </div>
  );
}
