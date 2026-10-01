import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../lib/utils';
import { ButtonBase } from './ButtonBase';
import { Tooltip } from './Tooltip';

interface StatItemProps {
  icon: ReactNode;
  label?: ReactNode;
  value?: ReactNode;
  tooltip?: string;
  onClick?: () => void;
  href?: string;
  tone?: 'default' | 'muted';
}

export function StatItem({
  icon,
  label,
  value,
  tooltip,
  onClick,
  href,
  tone = 'default',
}: StatItemProps) {
  const navigate = useNavigate();
  const interactive = onClick !== undefined || href !== undefined;

  const handleClick = () => {
    if (onClick) onClick();
    else if (href) navigate(href);
  };

  const className = cn(
    'inline-flex items-center gap-1.5 text-[11px] tabular-nums',
    interactive && 'rounded px-1.5 py-0.5 hover:bg-white/[0.04] transition-colors cursor-pointer'
  );

  const body = (
    <>
      <span className="shrink-0 text-slate-400" aria-hidden="true">
        {icon}
      </span>
      {label !== undefined && <span className="text-slate-400">{label}</span>}
      {value !== undefined && (
        <span className={tone === 'muted' ? 'text-slate-500' : 'text-slate-300'}>{value}</span>
      )}
    </>
  );

  const inner = interactive ? (
    <ButtonBase type="button" onClick={handleClick} className={className}>
      {body}
    </ButtonBase>
  ) : (
    <span className={className}>{body}</span>
  );

  return tooltip ? <Tooltip content={tooltip}>{inner}</Tooltip> : inner;
}
