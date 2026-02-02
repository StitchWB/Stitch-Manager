import React from 'react';

interface SparklineProps {
  data?: number[];
}

export const Sparkline = React.memo(function Sparkline({ data = [3, 7, 4, 9, 5, 8, 6] }: SparklineProps) {
  const max = Math.max(...data);
  const points = data.map((v, i) => `${i * 14},${20 - (v / max) * 18}`).join(' ');
  
  return (
    <svg className="w-20 h-5 opacity-50" viewBox="0 0 84 20">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
});
