import { cn } from '../../lib/utils';

interface ProviderLogoProps {
  provider: string;
  size?: number;
  className?: string;
  colored?: boolean;
}

// Simplified monochrome logos
export function ProviderLogo({ provider, size = 20, className, colored = false }: ProviderLogoProps) {
  const p = provider.toLowerCase();
  
  const colors = {
    kiro: colored ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-indigo-400',
    windsurf: colored ? 'text-cyan-400' : 'text-zinc-500 group-hover:text-cyan-400',
    trae: colored ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-emerald-400',
  };

  const color = colors[p as keyof typeof colors] || colors.kiro;

  // Kiro logo - stylized K
  if (p === 'kiro') {
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        className={cn('transition-colors duration-200', color, className)}
      >
        <path 
          d="M6 4v16M6 12l8-8M6 12l8 8" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // Windsurf logo - wave
  if (p === 'windsurf') {
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        className={cn('transition-colors duration-200', color, className)}
      >
        <path 
          d="M3 12c2-3 4-4 6-4s4 2 6 2 4-2 6-2" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round"
        />
        <path 
          d="M3 17c2-3 4-4 6-4s4 2 6 2 4-2 6-2" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    );
  }

  // Trae logo - T
  if (p === 'trae') {
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        className={cn('transition-colors duration-200', color, className)}
      >
        <path 
          d="M6 6h12M12 6v14" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // Default - circle
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      className={cn('transition-colors duration-200', color, className)}
    >
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
