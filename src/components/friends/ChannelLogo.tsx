import { useState } from 'react';
import { Send, MessageCircle, Github, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_ICON = {
  telegram: Send,
  discord: MessageCircle,
  github: Github,
  other: Globe,
} as const;

interface ChannelLogoProps {
  src?: string | null;
  type: keyof typeof TYPE_ICON;
  className?: string;
  iconSize?: number;
}

export function ChannelLogo({ src, type, className, iconSize = 16 }: ChannelLogoProps) {
  const [failed, setFailed] = useState(false);
  const Icon = TYPE_ICON[type] ?? Globe;
  const url = failed ? null : src;

  return (
    <div
      className={cn(
        'bg-white/5 flex items-center justify-center shrink-0 overflow-hidden',
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={iconSize} />
      )}
    </div>
  );
}
