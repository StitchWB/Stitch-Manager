import React from 'react';

export const StatCardSkeleton = React.memo(function StatCardSkeleton() {
  return (
    <div
      className="relative p-5 flex flex-col gap-4 rounded-xl"
      style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)' }}
    >
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
        <div className="w-20 h-5 bg-white/5 rounded animate-pulse" />
      </div>
      <div>
        <div className="w-24 h-10 bg-white/5 rounded animate-pulse mb-2" />
        <div className="w-32 h-3 bg-white/5 rounded animate-pulse" />
      </div>
    </div>
  );
});
