import { Cloud, Github, Flame, Code2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// Import provider icons
import kiroIcon from '../../assets/providers/kiro.png';
import traeIcon from '../../assets/providers/trae.png';
import antigravityIcon from '../../assets/providers/antigravity.png';
import claudeIcon from '../../assets/providers/claude.png';
import copilotIcon from '../../assets/providers/copilot.png';
import cursorIcon from '../../assets/providers/cursor.png';
import geminiIcon from '../../assets/providers/gemini.png';
import openaiIcon from '../../assets/providers/openai.png';
import iflowIcon from '../../assets/providers/iflow.png';
import glmIcon from '../../assets/providers/glm.png';
import qwenIcon from '../../assets/providers/qwen.png';
import warpIcon from '../../assets/providers/warp.png';
import vertexIcon from '../../assets/providers/vertex.png';
import bitbucketIcon from '../../assets/providers/bitbucket.png';

interface ProviderLogoProps {
  provider: string;
  size?: number;
  className?: string;
  colored?: boolean;
}

// Provider icon mapping
const providerIcons: Record<string, string> = {
  kiro: kiroIcon,
  trae: traeIcon,
  antigravity: antigravityIcon,
  claude: claudeIcon,
  copilot: copilotIcon,
  cursor: cursorIcon,
  gemini: geminiIcon,
  openai: openaiIcon,
  iflow: iflowIcon,
  glm: glmIcon,
  qwen: qwenIcon,
  warp: warpIcon,
  vertex: vertexIcon,
  bitbucket: bitbucketIcon,
};

// Fallback Lucide icons for providers without custom icons
const fallbackIcons = {
  aws: Cloud,
  aws_builder_id: Cloud,
  github: Github,
  fireworks: Flame,
  qoder: Code2,
  v0_app: Code2,
};

export function ProviderLogo({ provider, size = 20, className, colored = false }: ProviderLogoProps) {
  const p = provider.toLowerCase();
  const iconSrc = providerIcons[p];
  
  // If we have a custom PNG icon, use it
  if (iconSrc) {
    return (
      <img 
        src={iconSrc}
        alt={`${provider} logo`}
        width={size}
        height={size}
        className={cn(
          'transition-all duration-200 object-contain',
          colored && 'drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]',
          className
        )}
      />
    );
  }
  
  // Fallback to Lucide icon
  const FallbackIcon = fallbackIcons[p as keyof typeof fallbackIcons] || Cloud;
  
  return (
    <FallbackIcon 
      size={size} 
      className={cn(
        'transition-all duration-200',
        colored ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]' : 'text-slate-500 group-hover:text-white',
        className
      )}
    />
  );
}
