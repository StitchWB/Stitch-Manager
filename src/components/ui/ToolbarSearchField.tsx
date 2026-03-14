import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from './Input';

export interface ToolbarSearchFieldProps extends Omit<
  InputProps,
  'leftIcon' | 'value' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
}

export function ToolbarSearchField({
  value,
  onValueChange,
  shellClassName,
  className,
  ...props
}: ToolbarSearchFieldProps) {
  return (
    <Input
      value={value}
      onChange={event => onValueChange(event.target.value)}
      leftIcon={<Search size={14} />}
      shellClassName={cn('h-9', shellClassName)}
      className={cn('text-sm', className)}
      {...props}
    />
  );
}
