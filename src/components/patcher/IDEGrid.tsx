import type { DetectedIDE } from '../../types';
import IDECard from './IDECard';

interface IDEGridProps {
  ides: DetectedIDE[];
  selectedIDE: string | null;
  onSelectIDE: (ideId: string) => void;
}

export default function IDEGrid({ ides, selectedIDE, onSelectIDE }: IDEGridProps) {
  return (
    <div className="flex items-center gap-2 p-1.5 border-b border-white/[0.05] overflow-x-auto scrollbar-thin pb-4">
      {ides.map((ide: DetectedIDE) => (
        <IDECard
          key={ide.id}
          ide={ide}
          isActive={selectedIDE === ide.id}
          onSelect={onSelectIDE}
        />
      ))}
    </div>
  );
}
