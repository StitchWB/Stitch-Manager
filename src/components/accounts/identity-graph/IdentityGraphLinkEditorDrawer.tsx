import { t } from "@/lib/i18n";import { PenSquare, Trash2, X } from 'lucide-react';

import { Button, ButtonBase, Checkbox, Input, Select } from '@/components/ui';

type LinkEditorMode = 'create' | 'edit';

interface LinkEditorState {
  linkId: string;
  fromIdentityId: string;
  toServiceSheet: string;
  toServiceAccountId: string;
  isPrimary: boolean;
  linkType: string;
  status: string;
  note: string;
}

interface Option {
  value: string;
  label: string;
}

interface IdentityGraphLinkEditorDrawerProps {
  open: boolean;
  editorMode: LinkEditorMode;
  editorState: LinkEditorState;
  identityOptions: Option[];
  serviceSheetOptions: Option[];
  currentSheetServiceOptions: Option[];
  savingLink: boolean;
  deletingLink: boolean;
  onClose: () => void;
  onIdentityChange: (value: string) => void;
  onServiceSheetChange: (sheet: string) => void;
  onServiceAccountChange: (value: string) => void;
  onLinkTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onPrimaryChange: (checked: boolean) => void;
  onDelete: () => void;
  onSave: () => void;
}

export function IdentityGraphLinkEditorDrawer({
  open,
  editorMode,
  editorState,
  identityOptions,
  serviceSheetOptions,
  currentSheetServiceOptions,
  savingLink,
  deletingLink,
  onClose,
  onIdentityChange,
  onServiceSheetChange,
  onServiceAccountChange,
  onLinkTypeChange,
  onStatusChange,
  onNoteChange,
  onPrimaryChange,
  onDelete,
  onSave
}: IdentityGraphLinkEditorDrawerProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 bg-void-base/50 backdrop-blur-sm flex justify-end">
      <div className="w-full max-w-md h-full bg-ds-surface-elevated border-l border-white/10 p-4 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-white">
              {editorMode === 'create' ? 'Create link' : 'Edit link'}
            </div>
            <div className="text-[11px] text-slate-500">{t("accounts.identity_graph_link_editor_drawer.links_writeback")}</div>
          </div>
          <ButtonBase
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-slate-300">
            
            <X className="w-4 h-4" />
          </ButtonBase>
        </div>

        <div className="space-y-3">
          <Select
            label="Identity"
            value={editorState.fromIdentityId}
            onValueChange={onIdentityChange}
            options={identityOptions.map((option) => ({
              value: option.value,
              label: option.label
            }))} />
          

          <Select
            label="Service sheet"
            value={editorState.toServiceSheet}
            onValueChange={onServiceSheetChange}
            options={serviceSheetOptions.map((option) => ({
              value: option.value,
              label: option.label
            }))} />
          

          <Select
            label="Service account"
            value={editorState.toServiceAccountId}
            onValueChange={onServiceAccountChange}
            options={currentSheetServiceOptions.map((option) => ({
              value: option.value,
              label: option.label
            }))} />
          

          <Select
            label="Link type"
            value={editorState.linkType}
            onValueChange={onLinkTypeChange}
            options={[
            { value: 'oauth', label: 'oauth' },
            { value: 'password', label: 'password' },
            { value: 'recovery', label: 'recovery' },
            { value: 'phone', label: 'phone' },
            { value: 'unknown', label: 'unknown' }]
            } />
          

          <Select
            label="Status"
            value={editorState.status}
            onValueChange={onStatusChange}
            options={[
            { value: 'ok', label: 'ok' },
            { value: 'broken', label: 'broken' },
            { value: 'unknown', label: 'unknown' },
            { value: 'deleted', label: 'deleted' }]
            } />
          

          <Input
            label="Note"
            value={editorState.note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Optional note" />
          

          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <Checkbox
              checked={editorState.isPrimary}
              onChange={(checked) => onPrimaryChange(Boolean(checked))}
              label="Primary link" />
            
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {editorMode === 'edit' ?
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            onClick={onDelete}
            disabled={deletingLink || savingLink}>
            
              {deletingLink ? 'Deleting…' : 'Delete'}
            </Button> :

          <div />
          }
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{t("accounts.identity_graph_link_editor_drawer.cancel")}

            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PenSquare size={14} />}
              onClick={onSave}
              disabled={savingLink || deletingLink}>
              
              {savingLink ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>);

}