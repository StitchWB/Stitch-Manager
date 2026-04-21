import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { Button, EmptyState, Select } from '@/components/ui';
import { useRegistrationStore } from '@/stores/registration';
import { useGoogleSheetsDataset } from '@/hooks/useGoogleSheetsDataset';
import { parseMailboxDraftsFromGoogleSheetsRaw } from '@/lib/mail/sources/googleSheetsRawSource';
import type { MailboxProfileDraft } from '@/lib/mail/sources/types';
import { SheetsExplorerPanel } from '@/components/accounts/SheetsExplorerPanel';

interface GoogleSheetsRawMailboxImportProps {
  onSaveDraft: (draft: MailboxProfileDraft) => Promise<void>;
  isSaving?: boolean;
}

export function GoogleSheetsRawMailboxImport({
  onSaveDraft,
  isSaving = false,
}: GoogleSheetsRawMailboxImportProps) {
  const spreadsheetId = useRegistrationStore(
    state => state.config.advanced.googleSheetsSpreadsheetId || ''
  );
  const serviceAccountJson = useRegistrationStore(
    state => state.config.advanced.googleSheetsServiceAccountJson || ''
  );

  const sheetsParams = useMemo(() => {
    if (!spreadsheetId.trim() || !serviceAccountJson.trim()) return null;
    return {
      spreadsheetId: spreadsheetId.trim(),
      serviceAccountJson: serviceAccountJson.trim(),
    };
  }, [serviceAccountJson, spreadsheetId]);

  const { dataset, isLoading, error, refresh } = useGoogleSheetsDataset({
    autoFetch: Boolean(sheetsParams),
    params: sheetsParams,
  });

  const parsed = useMemo(() => parseMailboxDraftsFromGoogleSheetsRaw(dataset), [dataset]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');

  const effectiveSelectedDraftId =
    selectedDraftId || (parsed.drafts.length > 0 ? parsed.drafts[0].id : '');

  const selectedDraft = useMemo(
    () => parsed.drafts.find(draft => draft.id === effectiveSelectedDraftId) ?? null,
    [effectiveSelectedDraftId, parsed.drafts]
  );

  const draftOptions = useMemo(
    () =>
      parsed.drafts.map(draft => ({
        value: draft.id,
        label: `${draft.label} (${draft.accountId})`,
      })),
    [parsed.drafts]
  );

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white">
          <Database size={16} />
          <h2 className="text-sm font-semibold">Google Sheets (RAW)</h2>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={!sheetsParams || isLoading}
          leftIcon={<RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh
        </Button>
      </div>

      {!sheetsParams ? (
        <p className="text-xs text-slate-500">
          Configure Google Sheets credentials in settings/registration first. RAW import is
          mandatory.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      {parsed.issues.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 space-y-1">
          <p className="text-xs text-amber-100 flex items-center gap-1">
            <AlertTriangle size={12} /> {parsed.issues.length} row issue(s)
          </p>
          <div className="max-h-24 overflow-auto space-y-1 pr-1">
            {parsed.issues.slice(0, 8).map(issue => (
              <p key={issue.id} className="text-[11px] text-amber-200/90">
                [{issue.sheetName}:{issue.rowNumber}] {issue.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {parsed.drafts.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No mailbox drafts"
          description="No valid IMAP/Mail.tm rows found in RAW dataset"
          className="py-6"
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Detected mailboxes: {parsed.drafts.length}</p>
          <Select
            label="Mailbox draft"
            value={effectiveSelectedDraftId}
            options={draftOptions}
            onValueChange={value => setSelectedDraftId(value)}
          />

          {selectedDraft ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-2">
              <p className="text-xs text-white font-medium">{selectedDraft.label}</p>
              <p className="text-[11px] text-slate-400">
                {selectedDraft.provider} · {selectedDraft.accountId} · {selectedDraft.mailbox}
              </p>
            </div>
          ) : null}

          <Button
            size="sm"
            disabled={!selectedDraft || isSaving}
            leftIcon={<CheckCircle2 size={14} />}
            onClick={async () => {
              if (selectedDraft) {
                await onSaveDraft(selectedDraft);
              }
            }}
          >
            {isSaving ? 'Saving profile...' : 'Save as mailbox profile'}
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/20 h-[320px] overflow-hidden">
        <SheetsExplorerPanel
          dataset={dataset}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
        />
      </div>
    </section>
  );
}
