interface PatchVersion {
  id: string;
  label: string;
  description: string;
}

interface PatchVersionSelectorProps {
  versions: PatchVersion[];
  selectedVersion: string | undefined;
  currentPatchVersion: string | undefined;
  onSelectVersion: (versionId: string) => void;
}

export default function PatchVersionSelector({
  versions,
  selectedVersion,
  currentPatchVersion,
  onSelectVersion,
}: PatchVersionSelectorProps) {
  if (versions.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg">
      {versions.map(version => {
        const isSelected =
          selectedVersion === version.id || (!selectedVersion && currentPatchVersion === version.id);
        return (
          <button
            key={version.id}
            onClick={() => onSelectVersion(version.id)}
            className={`
              px-3 py-1.5 rounded-md text-xs font-medium transition-all
              ${
                isSelected
                  ? 'bg-primary text-white shadow-lg shadow-primary/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }
            `}
          >
            {version.label}
          </button>
        );
      })}
    </div>
  );
}
