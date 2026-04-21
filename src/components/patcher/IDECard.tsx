import { CheckCircle, XCircle } from 'lucide-react';

import type { DetectedIDE } from '../../types/ui';
import { getIDEIcon, getIDEGradient, getIDELabel } from '../../lib/patcher';
import { ButtonBase } from '@/components/ui';

interface IDECardProps {
  ide: DetectedIDE;
  isActive: boolean;
  onSelect: (ideId: string) => void;
}

export default function IDECard({ ide, isActive, onSelect }: IDECardProps) {
  const gradient = getIDEGradient(ide.type);

  return (
    <ButtonBase
      onClick={() => onSelect(ide.id)}
      className={`
        relative group flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium
        transition-all duration-300 whitespace-nowrap overflow-hidden
        ${
          isActive
            ? 'text-white shadow-[0_0_20px_rgba(0,0,0,0.3)] ring-1 ring-white/10'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
        }
      `}
    >
      {isActive && <div className={`absolute inset-0 bg-gradient-to-r ${gradient} opacity-20`} />}

      <div
        className={`
          relative w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0
          shadow-lg transition-transform duration-300 group-hover:scale-110
          ${isActive ? `bg-gradient-to-br ${gradient}` : 'bg-white/10'}
        `}
      >
        {getIDEIcon(ide.type)}
      </div>

      <span className="relative z-10 tracking-wide">{getIDELabel(ide.type)}</span>

      {ide.isPatched ? (
        <div className="relative z-10 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
          <CheckCircle className="w-3 h-3" />
        </div>
      ) : (
        <div className="relative z-10 flex items-center justify-center w-5 h-5 rounded-full bg-slate-500/10 text-slate-500">
          <XCircle className="w-3 h-3" />
        </div>
      )}
    </ButtonBase>
  );
}
