import { Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';

export interface SchedulerScheduleState {
  scheduleType: 'interval' | 'daily' | 'once';
  intervalSeconds: string;
  hour: string;
  minute: string;
  onceDateTime: string;
}

interface SchedulerScheduleSectionProps {
  value: SchedulerScheduleState;
  onChange: (next: SchedulerScheduleState) => void;
  title?: string;
  description?: string;
}

export function SchedulerScheduleSection({
  value,
  onChange,
  title = 'Schedule',
  description,
}: SchedulerScheduleSectionProps) {
  const set = (patch: Partial<SchedulerScheduleState>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
      <div>
        <div className="text-sm font-medium text-vsc-text">{title}</div>
        {description ? (
          <div className="text-xs text-vsc-text-muted mt-0.5">{description}</div>
        ) : null}
      </div>

      <Select
        label="Schedule type"
        value={value.scheduleType}
        onChange={e => set({ scheduleType: e.target.value as 'interval' | 'daily' | 'once' })}
      >
        <option value="interval">{t('scheduler.scheduleInterval')}</option>
        <option value="daily">{t('scheduler.scheduleDaily')}</option>
        <option value="once">{t('scheduler.scheduleOnce')}</option>
      </Select>

      {value.scheduleType === 'interval' ? (
        <Input
          label="Interval seconds"
          type="number"
          min="1"
          value={value.intervalSeconds}
          onChange={e => set({ intervalSeconds: e.target.value })}
        />
      ) : null}

      {value.scheduleType === 'daily' ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Hour"
            type="number"
            min="0"
            max="23"
            value={value.hour}
            onChange={e => set({ hour: e.target.value })}
          />
          <Input
            label="Minute"
            type="number"
            min="0"
            max="59"
            value={value.minute}
            onChange={e => set({ minute: e.target.value })}
          />
        </div>
      ) : null}

      {value.scheduleType === 'once' ? (
        <Input
          label="Date & time"
          type="datetime-local"
          value={value.onceDateTime}
          onChange={e => set({ onceDateTime: e.target.value })}
        />
      ) : null}
    </div>
  );
}
