import { SegmentedControl } from '../ui';

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

  const resolvedValue = selectedVersion || currentPatchVersion || versions[0]?.id || '';

  const options = versions.map(version => ({
    value: version.id,
    label: version.label,
  }));

  return (
    <SegmentedControl
      options={options}
      value={resolvedValue}
      onChange={onSelectVersion}
      stretch={false}
      size="sm"
      className="inline-flex"
    />
  );
}
