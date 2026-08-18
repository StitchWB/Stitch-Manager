import { Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';

export type SchedulerTaskCreateMode = 'manual' | 'template';

interface TemplateOption {
  id: number;
  name: string;
}

interface SchedulerTaskCreationModeSectionProps {
  mode: SchedulerTaskCreateMode;
  onModeChange: (mode: SchedulerTaskCreateMode) => void;
  templateId: number | null;
  onTemplateIdChange: (templateId: number | null) => void;
  templateNameOverride: string;
  onTemplateNameOverrideChange: (value: string) => void;
  templates: TemplateOption[];
  templatesLoading: boolean;
}

export function SchedulerTaskCreationModeSection({
  mode,
  onModeChange,
  templateId,
  onTemplateIdChange,
  templateNameOverride,
  onTemplateNameOverrideChange,
  templates,
  templatesLoading,
}: SchedulerTaskCreationModeSectionProps) {
  return (
    <div className="space-y-4">
      <Select
        label="Create mode"
        value={mode}
        onChange={e => onModeChange(e.target.value as SchedulerTaskCreateMode)}
      >
        <option value="manual">{t('scheduler.taskTypeManual')}</option>
        <option value="template">{t('scheduler.taskTypeTemplate')}</option>
      </Select>

      {mode === 'template' ? (
        <>
          <Select
            label="Template"
            value={templateId ? String(templateId) : ''}
            onChange={e => {
              const n = Number(e.target.value);
              onTemplateIdChange(Number.isFinite(n) && n > 0 ? n : null);
            }}
          >
            <option value="">{templatesLoading ? 'Loading templates…' : 'Select template…'}</option>
            {templates.map(tpl => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </Select>

          <Input
            label="Task Name Override (optional)"
            value={templateNameOverride}
            onChange={e => onTemplateNameOverrideChange(e.target.value)}
            placeholder="Leave empty to use template name"
          />
        </>
      ) : null}
    </div>
  );
}
