import ProfilesTable, { type ProfileItem } from '../ProfilesTable';
import { SkeletonLoader } from '@/components/ui';


interface ProfilesSectionProps {
  profilesLoading: boolean;
  profiles: ProfileItem[];
  onEdit: (alias: string) => void;
  onOpen: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onDelete: (alias: string) => Promise<void>;
  onOpenScenarios?: (alias: string) => void;
  openTarget: string;
  customUrl: string;
  className?: string;
  skeletonCount?: number;
  shardAvailable?: boolean;
}

export function ProfilesSection({
  profilesLoading,
  profiles,
  onEdit,
  onOpen,
  onDelete,
  onOpenScenarios,
  openTarget,
  customUrl,
  className,
  skeletonCount = 6,
  shardAvailable = false,
}: ProfilesSectionProps) {
  return (
    <div className={className ?? 'flex flex-col h-full'}>
      {profilesLoading ? (
        <div className="p-6">
          <SkeletonLoader variant="table-row" count={skeletonCount} />
        </div>
      ) : (
        <ProfilesTable
          profiles={profiles}
          onEdit={onEdit}
          onOpen={onOpen}
          onDelete={onDelete}
          onOpenScenarios={onOpenScenarios}
          openTarget={openTarget}
          customUrl={customUrl}
          shardAvailable={shardAvailable}
        />
      )}
    </div>
  );
}
