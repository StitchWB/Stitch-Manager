import { Tooltip } from '@/components/Tooltip';
import { Input, Button, Checkbox, FormGrid } from '@/components/ui';
import { Filter, Search } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface InboxFiltersSectionProps {
  queryFrom: string;
  onQueryFromChange: (value: string) => void;
  querySubject: string;
  onQuerySubjectChange: (value: string) => void;
  queryBody: string;
  onQueryBodyChange: (value: string) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (value: boolean) => void;
  session: unknown;
  isBusy: boolean;
  disabled?: boolean;
  onList: () => void;
  allExpanded: boolean;
}

export function InboxFiltersSection({
  queryFrom,
  onQueryFromChange,
  querySubject,
  onQuerySubjectChange,
  queryBody,
  onQueryBodyChange,
  unreadOnly,
  onUnreadOnlyChange,
  session,
  isBusy,
  disabled,
  onList,
  allExpanded,
}: InboxFiltersSectionProps) {
  return (
    <CollapsibleSection
      title="Фильтры"
      description="Критерии поиска писем"
      icon={<Filter className="w-5 h-5 text-slate-400" />}
      defaultExpanded={allExpanded || false}
      disabled={disabled || !session}
      className="p-3"
    >
      <div className={cn('space-y-3', !session && 'opacity-60')}>
        <FormGrid responsive>
          <Tooltip content="Фильтр по отправителю. Оставьте пустым для всех писем">
            <Input
              label="Отправитель содержит"
              value={queryFrom}
              onChange={e => onQueryFromChange(e.target.value)}
              placeholder="например, noreply@"
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
          <Tooltip content="Фильтр по теме письма">
            <Input
              label="Тема содержит"
              value={querySubject}
              onChange={e => onQuerySubjectChange(e.target.value)}
              placeholder="например, verification"
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
          <Tooltip content="Фильтр по содержимому письма">
            <Input
              label="Тело содержит"
              value={queryBody}
              onChange={e => onQueryBodyChange(e.target.value)}
              placeholder="например, код подтверждения"
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
          <div className="flex items-end">
            <Tooltip content="Проверять только непрочитанные письма">
              <Checkbox
                checked={unreadOnly}
                onChange={e => onUnreadOnlyChange(e.target.checked)}
                disabled={!session || disabled || isBusy}
                label="Только непрочитанные"
              />
            </Tooltip>
          </div>
        </FormGrid>

        <div className="flex gap-2 flex-wrap">
          <Tooltip content="Показать список полученных писем">
            <Button
              variant="primary"
              size="sm"
              onClick={onList}
              disabled={!session || disabled || isBusy}
            >
              <Search className="w-4 h-4" /> Список
            </Button>
          </Tooltip>
        </div>
      </div>
    </CollapsibleSection>
  );
}
