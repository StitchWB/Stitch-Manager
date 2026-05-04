import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SegmentedControl } from './SegmentedControl';

export interface ViewModeSwitchOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface ViewModeSwitchProps {
  value: string;
  onChange: (value: string) => void;
  options: ViewModeSwitchOption[];
  className?: string;
}

export function ViewModeSwitch({ value, onChange, options, className }: ViewModeSwitchProps) {
  return (
    <SegmentedControl
      size="sm"
      stretch={false}
      value={value}
      onChange={onChange}
      options={options}
      className={cn('h-8 shrink-0', className)}
    />
  );
}
