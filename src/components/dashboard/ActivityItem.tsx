import React from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ActivityItemProps {
  status: 'success' | 'pending' | 'failed';
  title: string;
  description: string;
  timestamp: string;
}

export const ActivityItem = React.memo(function ActivityItem({
  status,
  title,
  description,
  timestamp,
}: ActivityItemProps) {
  const config = {
    success: {
      icon: <CheckCircle size={16} />,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      rowBg: '',
      borderColor: '',
    },
    pending: {
      icon: <Loader2 size={16} className="animate-spin" />,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      rowBg: '',
      borderColor: '',
    },
    failed: {
      icon: <XCircle size={16} />,
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      rowBg: 'bg-red-500/[0.05]',
      borderColor: 'border-l-2 border-red-500',
    },
  }[status];

  return (
    <div
      className={`flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-white/[0.02] transition-colors group ${config.rowBg} ${config.borderColor}`}
    >
      <div
        className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center ${config.color}`}
      >
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{title}</p>
        <p
          className={`text-2xs truncate ${status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}
        >
          {description}
        </p>
      </div>
      <span className="text-2xs text-slate-600 font-mono tabular-nums">{timestamp}</span>
    </div>
  );
});
