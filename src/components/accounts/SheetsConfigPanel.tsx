import { t } from '@/lib/i18n';
import { FormField } from '@/components/ui';

interface SheetsConfigPanelProps {
  spreadsheetId: string;
  serviceAccountJson: string;
  testStatus: 'idle' | 'loading' | 'success' | 'error';
  testMessage: string | null;
  onSpreadsheetIdChange: (value: string) => void;
  onServiceAccountJsonChange: (value: string) => void;
}

export function SheetsConfigPanel({
  spreadsheetId,
  serviceAccountJson,
  testStatus,
  testMessage,
  onSpreadsheetIdChange,
  onServiceAccountJsonChange,
}: SheetsConfigPanelProps) {
  return (
    <div className="shrink-0 border-b border-white/5 bg-vsc-bg/65 px-6 pb-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)]">
          <FormField
            inputProps={{
              label: t('accounts.sheetsSpreadsheetId'),
              value: spreadsheetId,
              onChange: event => onSpreadsheetIdChange(event.target.value),
              placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            }}
          />
          <FormField
            type="textarea"
            textareaProps={{
              label: t('accounts.sheetsServiceAccountJson'),
              value: serviceAccountJson,
              onChange: event => onServiceAccountJsonChange(event.target.value),
              placeholder: '{"type":"service_account", ...}',
              rows: 4,
              className: 'font-mono text-[11px]',
            }}
          />
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          {testStatus === 'success' && t('validation.connectionSuccess')}
          {testStatus === 'error' && (testMessage || t('validation.connectionFailed'))}
        </div>
      </div>
    </div>
  );
}
