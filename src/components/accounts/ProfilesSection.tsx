import ProfilesTable, { type ProfileItem } from '../ProfilesTable';
import { SkeletonLoader } from '../ui';

interface ProfilesSectionProps {
  profilesLoading: boolean;
  profiles: ProfileItem[];
  onEdit: (alias: string) => void;
  onOpen: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onStartAutoreg: (
    alias: string,
    targetProvider: string,
    preset?: 'kiro_via_aws_session',
    awsBootstrapAccountId?: number
  ) => void;
  onDelete: (alias: string) => Promise<void>;
  profileFilter: 'all' | 'standalone' | 'linked' | 'used_kiro';
  onProfileFilterChange: (value: 'all' | 'standalone' | 'linked' | 'used_kiro') => void;
  className?: string;
  skeletonCount?: number;
}

export function ProfilesSection({
  profilesLoading,
  profiles,
  onEdit,
  onOpen,
  onStartAutoreg,
  onDelete,
  profileFilter,
  onProfileFilterChange,
  className,
  skeletonCount = 6,
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
          onStartAutoreg={onStartAutoreg}
          onDelete={onDelete}
          profileFilter={profileFilter}
          onProfileFilterChange={onProfileFilterChange}
        />
      )}
    </div>
  );
}
