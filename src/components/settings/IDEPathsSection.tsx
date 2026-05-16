import { Code, FolderOpen, X } from 'lucide-react';



import { t } from '@/lib/i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Input, SectionHeader } from '@/components/ui';

interface IDEPathsSectionProps {
  customIdePaths: Record<string, string>;
  onCustomIdePathsChange: (paths: Record<string, string>) => void;
}

export function IDEPathsSection({
  customIdePaths,
  onCustomIdePathsChange,
}: IDEPathsSectionProps) {
  const handlePathChange = (ide: string, path: string) => {
    onCustomIdePathsChange({ ...customIdePaths, [ide]: path });
  };

  const handlePathRemove = (ide: string) => {
    const next = { ...customIdePaths };
    delete next[ide];
    onCustomIdePathsChange(next);
  };

  const handleBrowse = async (ide: string) => {
    try {
      const selected = await open({
        directory: true,
        title: `Select ${ide} extension folder`,
      });
      if (selected) {
        handlePathChange(ide, selected as string);
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  };

  return (
    <SectionHeader
      title={t('settings.idePaths.title')}
      description={t('settings.idePaths.description')}
      icon={<Code className="w-4 h-4 text-primary" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="space-y-4">
        {['kiro', 'windsurf', 'trae'].map(ide => (
          <div key={ide} className="flex items-center gap-4">
            <span className="text-[10px] uppercase font-bold text-slate-500 w-20 px-1">
              {ide}
            </span>
            <Input
              placeholder={`Path to ${ide} extension folder...`}
              value={customIdePaths[ide] || ''}
              onChange={e => handlePathChange(ide, e.target.value)}
              className="font-mono text-xs"
              rightElement={
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleBrowse(ide)}
                  >
                    <FolderOpen size={14} />
                  </Button>
                  {customIdePaths[ide] && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500/50 hover:text-red-400"
                      onClick={() => handlePathRemove(ide)}
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              }
            />
          </div>
        ))}
      </div>
    </SectionHeader>
  );
}
