import React from 'react';
import { motion } from 'framer-motion';

interface SparklineProps {
  data?: number[];
}

export const Sparkline = React.memo(function Sparkline({ data = [3, 7, 4, 9, 5, 8, 6] }: SparklineProps) {
  const max = Math.max(...data);
  const points = data
    .map((v, i) => `${i * 14},${max > 0 ? 20 - (v / max) * 18 : 18}`)
    .join(' ');

  return (
    <svg className="w-20 h-5" viewBox="0 0 84 20">
      <motion.polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
        pathLength={1}
        style={{ strokeDasharray: 1 }}
        initial={{ strokeDashoffset: 1 }}
        animate={{ strokeDashoffset: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  );
});
