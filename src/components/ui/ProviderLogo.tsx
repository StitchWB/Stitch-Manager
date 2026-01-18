import { Cloud, Github, Code, Wind, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ProviderLogoProps {
  provider: string;
  size?: number;
  className?: string;
  colored?: boolean;
}

// Brand colors with glow effect
const providerConfig = {
  kiro: {
    color: 'text-purple-400',
    hoverColor: 'group-hover:text-purple-400',
    glow: 'drop-shadow-[0_0_8px_rgba(167,139,250,0.6)]',
    Icon: Code,
  },
  windsurf: {
    color: 'text-cyan-400',
    hoverColor: 'group-hover:text-cyan-400',
    glow: 'drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]',
    Icon: Wind,
  },
  trae: {
    color: 'text-orange-400',
    hoverColor: 'group-hover:text-orange-400',
    glow: 'drop-shadow-[0_0_8px_rgba(251,146,60,0.6)]',
    Icon: Zap,
  },
  aws: {
    color: 'text-orange-500',
    hoverColor: 'group-hover:text-orange-500',
    glow: 'drop-shadow-[0_0_8px_rgba(249,115,22,0.6)]',
    Icon: Cloud,
  },
  aws_builder_id: {
    color: 'text-orange-500',
    hoverColor: 'group-hover:text-orange-500',
    glow: 'drop-shadow-[0_0_8px_rgba(249,115,22,0.6)]',
    Icon: Cloud,
  },
  github: {
    color: 'text-white',
    hoverColor: 'group-hover:text-white',
    glow: 'drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]',
    Icon: Github,
  },
};

export function ProviderLogo({ provider, size = 20, className, colored = false }: ProviderLogoProps) {
  const p = provider.toLowerCase();
  const config = providerConfig[p as keyof typeof providerConfig] || providerConfig.kiro;
  
  const Icon = config.Icon;
  const colorClass = colored ? config.color : `text-slate-500 ${config.hoverColor}`;
  const glowClass = colored ? config.glow : '';

  return (
    <Icon 
      size={size} 
      className={cn(
        'transition-all duration-200',
        colorClass,
        glowClass,
        className
      )}
    />
  );
}
