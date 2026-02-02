import React from 'react';
import { SkeletonLoader } from '../ui';

export const StatCardSkeleton = React.memo(function StatCardSkeleton() {
  return (
    <div
      className="relative p-5 flex flex-col gap-4 rounded-xl"
      style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)' }}
    >
      <div className="flex items-center justify-between">
        <SkeletonLoader variant="circle" width="32px" height="32px" />
        <SkeletonLoader variant="rectangle" width="80px" height="20px" />
      </div>
      <div>
        <SkeletonLoader variant="rectangle" width="96px" height="40px" className="mb-2" />
        <SkeletonLoader variant="rectangle" width="128px" height="12px" />
      </div>
    </div>
  );
});
