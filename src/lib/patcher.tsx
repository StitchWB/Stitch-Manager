import { Code2, Wind, Terminal } from 'lucide-react';
import { IDE_CONFIG } from '../constants/patcher';

export const truncateMiddle = (path: string, maxLength: number = 50): string => {
  if (path.length <= maxLength) return path;
  const parts = path.split(/[/\\]/);
  if (parts.length <= 2) return path;
  const fileName = parts[parts.length - 1];
  const firstPart = parts[0];
  const remaining = maxLength - firstPart.length - fileName.length - 5;
  if (remaining < 0) return `...${fileName}`;
  return `${firstPart}${parts.length > 2 ? '/.../' : '/'}${fileName}`;
};

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getIDEIcon = (type: string) => {
  const iconType = (IDE_CONFIG[type] || IDE_CONFIG.other).iconType;
  switch (iconType) {
    case 'Code2':
      return <Code2 size={18} />;
    case 'Wind':
      return <Wind size={18} />;
    case 'Terminal':
      return <Terminal size={18} />;
    default:
      return <Terminal size={18} />;
  }
};

export const getIDEGradient = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).gradient;
export const getIDELabel = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).label;
