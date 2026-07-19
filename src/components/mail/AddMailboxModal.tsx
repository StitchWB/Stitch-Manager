import { Cloud, Database, Mail as MailIcon, Server, Wand2 } from 'lucide-react';
import { ButtonBase, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';

export type AddMailboxSource = 'icloud' | 'gmail' | 'imap' | 'fromAutoReg' | 'fromSheets' | 'mailTmManual';

interface SourceCardConfig {
  id: AddMailboxSource;
  icon: React.ReactNode;
  titleKey: string;
  descriptionKey: string;
  accent: string;
}

const SOURCE_CARDS: SourceCardConfig[] = [
  {
    id: 'icloud',
    icon: <Cloud size={18} />,
    titleKey: 'mail.addMailboxICloud',
    descriptionKey: 'mail.addMailboxICloudDescription',
    accent: 'text-sky-300',
  },
  {
    id: 'gmail',
    icon: <MailIcon size={18} />,
    titleKey: 'mail.addMailboxGmail',
    descriptionKey: 'mail.addMailboxGmailDescription',
    accent: 'text-red-300',
  },
  {
    id: 'imap',
    icon: <Server size={18} />,
    titleKey: 'mail.addMailboxImap',
    descriptionKey: 'mail.addMailboxImapDescription',
    accent: 'text-emerald-300',
  },
  {
    id: 'fromAutoReg',
    icon: <Wand2 size={18} />,
    titleKey: 'mail.addMailboxFromAutoReg',
    descriptionKey: 'mail.addMailboxFromAutoRegDescription',
    accent: 'text-indigo-300',
  },
  {
    id: 'fromSheets',
    icon: <Database size={18} />,
    titleKey: 'mail.addMailboxFromSheets',
    descriptionKey: 'mail.addMailboxFromSheetsDescription',
    accent: 'text-amber-300',
  },
];

interface AddMailboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (source: AddMailboxSource) => void;
}

/**
 * Card-based entry point for adding a mailbox, replacing the small dropdown
 * menu. Each card routes to the appropriate follow-up flow (preset connect
 * modal, Auto-Reg sync, or Google Sheets import).
 */
export function AddMailboxModal({ isOpen, onClose, onSelect }: AddMailboxModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('mail.addMailboxModalTitle')} size="md">
      <div className="space-y-2">
        <p className="text-xs text-slate-400 mb-3">{t('mail.addMailboxModalDescription')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SOURCE_CARDS.map(card => (
            <ButtonBase
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              className="text-left rounded-lg border border-white/10 bg-black/20 p-3 hover:border-white/25 hover:bg-white/5 transition-colors flex flex-col gap-1.5"
            >
              <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
                <span className={card.accent}>{card.icon}</span>
                {t(card.titleKey)}
              </span>
              <span className="text-[11px] text-slate-400 leading-relaxed">
                {t(card.descriptionKey)}
              </span>
            </ButtonBase>
          ))}
        </div>
      </div>
    </Modal>
  );
}
